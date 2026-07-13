import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { makeModel, Tier, withKeyRotation } from "../llm/models";
import {
  analyzeWeek,
  compactAnalysis,
  fetchWeekEvents,
  getSplitById,
  splitsMetadata,
  todayISO,
} from "../services/dataFiles";
import { calcDayTargets } from "../services/nutrition";
import { getProfile, saveWeeklyPlan, WeeklyPlan } from "../services/store";
import { contentToString, extractJson, TraceStep } from "./runner";

/**
 * The "Generate my week" pipeline — a sequential multi-agent workflow:
 *   ScheduleAnalyst (pure code analysis) -> WorkoutPlanner (LLM chooses split
 *   + maps days) -> NutritionCoach (LLM designs meals around computed targets).
 * LLMs make choices; deterministic code computes numbers and attaches ground
 * truth (real exercises + video URLs from the splits DB), so nothing can be
 * hallucinated into the final plan.
 */

async function jsonAgent<T>(
  name: string,
  tier: Tier,
  system: string,
  user: string,
  trace: TraceStep[]
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    // Deliberate exception to "leave Gemini 3 defaults alone" (models.ts):
    // this step extracts strict JSON, not open reasoning, and a low
    // temperature measurably reduces formatting drift here.
    const res = await withKeyRotation(async () =>
      makeModel(tier, 0.15).invoke([
        new SystemMessage(system + "\nReturn ONLY a valid JSON object. No markdown, no commentary."),
        new HumanMessage(
          attempt === 0 ? user : user + "\n\nYour previous answer was not valid JSON. Return ONLY valid JSON."
        ),
      ])
    );
    const text = contentToString(res.content);
    trace.push({
      agent: name,
      kind: "llm",
      label: `${name} produced its section of the plan`,
      detail: text.slice(0, 400),
      ms: Date.now() - t0,
    });
    try {
      return extractJson<T>(text);
    } catch {
      if (attempt === 1) throw new Error(`${name} returned invalid JSON twice.`);
    }
  }
  throw new Error("unreachable");
}

interface PlannerOut {
  splitId: string;
  rationale: string;
  assignments: { date: string; dayName: string | null; slot?: string; note?: string }[];
}
interface MealsOut {
  days: { date: string; meals: { name: string; time: string; items: string[]; kcal: number }[]; tip?: string }[];
}

export async function generateWeeklyPlan(
  weekStartArg?: string
): Promise<{ plan: WeeklyPlan; trace: TraceStep[] }> {
  const trace: TraceStep[] = [];
  const weekStart = weekStartArg || todayISO();
  const profile = await getProfile();

  // ---- Step 1: Schedule analysis (deterministic) ----
  const t0 = Date.now();
  const { events, owner, source } = await fetchWeekEvents(weekStart);
  const analysis = analyzeWeek(weekStart, events);
  const compact = compactAnalysis(analysis);
  trace.push({
    agent: "ScheduleAnalyst",
    kind: "tool",
    label: `Fetched ${events.length} calendar events for ${owner.name ?? "user"} (${source})`,
    detail: compact
      .map((d) => `${d.date} ${d.weekday}: workload ${d.workloadScore}/10, ${d.events.length} events`)
      .join("\n"),
    ms: Date.now() - t0,
  });

  // ---- Step 2: WorkoutPlanner picks a split and maps days ----
  const planner = await jsonAgent<PlannerOut>(
    "WorkoutPlanner",
    "smart",
    `You are WorkoutPlanner. Choose the best split from the database and map its training days onto the week.
Rules:
- splitId MUST be one of the given ids. Use each split day name at most once.
- Never place a workout on a day whose longest free window is shorter than the split's session length; prefer low-workload days for the hardest sessions.
- Cover ALL 7 dates: workout days get a dayName from the split, rest days get dayName null.
- "slot" is the chosen time window like "18:45-20:00", picked INSIDE a listed free window.
Output schema: {"splitId": string, "rationale": string (2-3 sentences, mention the schedule trade-offs), "assignments": [{"date": "YYYY-MM-DD", "dayName": string|null, "slot": string|null, "note": string}]}`,
    JSON.stringify({
      userGoal: profile.goal,
      splitsDatabase: splitsMetadata(),
      weekSchedule: compact,
    }),
    trace
  );

  const split = getSplitById(planner.splitId);
  if (!split) throw new Error(`Planner chose unknown split "${planner.splitId}"`);

  // ---- Step 3: attach ground-truth exercises + compute nutrition targets (code) ----
  const days: WeeklyPlan["days"] = {};
  for (const dayInfo of analysis) {
    const a = planner.assignments.find((x) => x.date === dayInfo.date);
    const template = a?.dayName ? split.days.find((d) => d.day === a.dayName) : undefined;
    const isTraining = Boolean(template);
    const targets = calcDayTargets(profile, {
      trainingMinutes: isTraining ? split.sessionMinutes : 0,
      workloadScore: dayInfo.workloadScore,
    });
    days[dayInfo.date] = {
      type: isTraining ? "workout" : "rest",
      dayName: template?.day ?? null,
      slot: a?.slot ?? null,
      note: a?.note ?? null,
      weekday: dayInfo.weekday,
      workloadScore: dayInfo.workloadScore,
      exercises: template?.exercises ?? [],
      nutrition: { ...targets, meals: [] as any[], tip: null as string | null },
    };
  }

  // ---- Step 4: NutritionCoach designs meals around the computed targets ----
  const mealInput = Object.entries(days).map(([date, d]: [string, any]) => ({
    date,
    weekday: d.weekday,
    isTraining: d.type === "workout",
    slot: d.slot,
    workloadScore: d.workloadScore,
    targets: {
      calories: d.nutrition.calories,
      protein: d.nutrition.protein,
      carbs: d.nutrition.carbs,
      fat: d.nutrition.fat,
      waterL: d.nutrition.waterL,
    },
  }));

  const meals = await jsonAgent<MealsOut>(
    "NutritionCoach",
    "smart",
    `You are NutritionCoach. For each day, design 4 meals (breakfast, lunch, snack, dinner) that roughly sum to that day's calorie target, hit the protein target, and suit a student in Dhaka (rice, dal, eggs, chicken, fish, vegetables, milk, oats, fruit, affordable options).
On training days place a carb+protein meal within ~2h before or after the workout slot. On busy days (workload>=7) prefer quick/portable meals.
Output schema: {"days":[{"date":"YYYY-MM-DD","meals":[{"name":string,"time":"HH:MM","items":[string,...],"kcal":number}],"tip":string}]}
The per-meal kcal values must roughly sum to the day's calorie target.`,
    JSON.stringify({ goal: profile.goal, days: mealInput }),
    trace
  );

  for (const md of meals.days ?? []) {
    if (days[md.date]) {
      days[md.date].nutrition.meals = md.meals ?? [];
      days[md.date].nutrition.tip = md.tip ?? null;
    }
  }

  // ---- Step 5: persist (long-term memory) ----
  const plan: WeeklyPlan = {
    weekStart,
    splitId: split.id,
    splitName: split.name,
    rationale: planner.rationale,
    days,
    createdAt: new Date().toISOString(),
  };
  await saveWeeklyPlan(plan);
  trace.push({
    agent: "Orchestrator",
    kind: "tool",
    label: "Saved weekly plan",
    detail: `${split.name}, ${Object.values(days).filter((d: any) => d.type === "workout").length} training days`,
    ms: 0,
  });

  return { plan, trace };
}
