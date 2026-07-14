import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  analyzeWeek,
  compactAnalysis,
  fetchWeekEvents,
  getSplitById,
  splitsMetadata,
  todayISO,
} from "../services/dataFiles";
import { calcDayTargets } from "../services/nutrition";
import {
  getLatestPlan,
  getMealLogs,
  getProfile,
  getWorkoutLogs,
} from "../services/store";

/**
 * Tools = the hands of the agents. LLMs reason; tools fetch real data or run
 * deterministic math. Every tool returns a JSON string the model can read.
 */

export const getWeeklyScheduleTool = tool(
  async ({ weekStart }: { weekStart?: string }) => {
    const start = weekStart || todayISO();
    const { events, owner, source } = await fetchWeekEvents(start);
    const analysis = analyzeWeek(start, events);
    return JSON.stringify({
      today: todayISO(),
      owner,
      source,
      weekStart: start,
      days: compactAnalysis(analysis),
    });
  },
  {
    name: "get_weekly_schedule",
    description:
      "Fetches the user's calendar for 7 days starting at weekStart (default: today) via the calendar API, plus a computed per-day workload score (0-10) and free time windows.",
    schema: z.object({
      weekStart: z
        .string()
        .optional()
        .describe("ISO date YYYY-MM-DD; defaults to today"),
    }),
  }
);

export const listSplitsTool = tool(
  async () => JSON.stringify({ splits: splitsMetadata() }),
  {
    name: "list_workout_splits",
    description:
      "Lists all workout splits available in the splits database (id, name, days per week, session length, focus, day names). Use this before choosing a split.",
    schema: z.object({}),
  }
);

export const getSplitDetailsTool = tool(
  async ({ splitId }: { splitId: string }) => {
    const split = getSplitById(splitId);
    if (!split) return JSON.stringify({ error: `No split with id "${splitId}"` });
    // Compact: names + volume only. Full detail (URLs, notes) is attached by server code.
    return JSON.stringify({
      id: split.id,
      name: split.name,
      days: split.days.map((d) => ({
        day: d.day,
        exercises: d.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`),
      })),
    });
  },
  {
    name: "get_split_details",
    description: "Returns the training days and exercises of one split from the database.",
    schema: z.object({ splitId: z.string() }),
  }
);

export const calcNutritionTool = tool(
  async ({
    trainingMinutes,
    workloadScore,
  }: {
    trainingMinutes: number;
    workloadScore: number;
  }) => {
    const profile = await getProfile();
    const targets = calcDayTargets(profile, { trainingMinutes, workloadScore });
    return JSON.stringify({ profile: { goal: profile.goal, weightKg: profile.weightKg }, targets });
  },
  {
    name: "calculate_nutrition_targets",
    description:
      "Deterministically computes calorie/protein/carb/fat/water targets for ONE day using Mifflin-St Jeor, given that day's training minutes and workload score (0-10). Always use this instead of guessing numbers.",
    schema: z.object({
      trainingMinutes: z.number().describe("planned resistance training minutes that day (0 on rest days)"),
      workloadScore: z.number().describe("day busyness 0-10 from the schedule analysis"),
    }),
  }
);

export const getProfileTool = tool(
  async () => JSON.stringify(await getProfile()),
  {
    name: "get_user_profile",
    description: "Returns the user's profile: age, sex, height, weight and fitness goal.",
    schema: z.object({}),
  }
);

export const getCurrentPlanTool = tool(
  async () => {
    const today = todayISO();
    const plan = await getLatestPlan();
    if (!plan) return JSON.stringify({ today, plan: null, note: "No weekly plan generated yet." });
    const sessionMinutes = getSplitById(plan.splitId)?.sessionMinutes ?? 60;
    const days = Object.entries(plan.days).map(([date, d]: [string, any]) => ({
      date,
      isToday: date === today,
      weekday: d.weekday ?? null,
      type: d.type,
      dayName: d.dayName ?? "Rest",
      slot: d.slot ?? null,
      workloadScore: d.workloadScore ?? null,
      trainingMinutes: d.type === "workout" ? sessionMinutes : 0,
      targets: d.nutrition
        ? {
            calories: d.nutrition.calories,
            protein: d.nutrition.protein,
            carbs: d.nutrition.carbs,
            fat: d.nutrition.fat,
            waterL: d.nutrition.waterL,
          }
        : null,
    }));
    return JSON.stringify({
      today,
      weekStart: plan.weekStart,
      split: plan.splitName,
      sessionMinutes,
      rationale: plan.rationale,
      days,
    });
  },
  {
    name: "get_current_plan",
    description:
      "Returns the currently saved weekly plan: per day — date (with isToday flag), workout/rest, day name, time slot, workload score (0-10), training minutes, and the pre-computed nutrition targets (calories/protein/carbs/fat/water). Use this FIRST for any question about today's or a specific day's workout or nutrition; it usually already contains the numbers you need.",
    schema: z.object({}),
  }
);

export const getProgressDataTool = tool(
  async ({ days }: { days?: number }) => {
    const since = new Date(Date.now() - (days ?? 14) * 86400000)
      .toISOString()
      .slice(0, 10);
    const [workouts, meals, profile, plan] = await Promise.all([
      getWorkoutLogs(since),
      getMealLogs(since),
      getProfile(),
      getLatestPlan(),
    ]);

    const volumeByExercise: Record<string, { sessions: number; bestSet: string; totalVolume: number }> = {};
    for (const w of workouts) {
      const v = (volumeByExercise[w.exercise] ??= { sessions: 0, bestSet: "-", totalVolume: 0 });
      v.sessions++;
      let best = 0;
      for (const s of w.sets) {
        v.totalVolume += s.weight * s.reps;
        if (s.weight * s.reps > best) {
          best = s.weight * s.reps;
          v.bestSet = `${s.weight}kg x ${s.reps}`;
        }
      }
    }
    const kcalByDate: Record<string, number> = {};
    for (const m of meals) kcalByDate[m.date] = (kcalByDate[m.date] ?? 0) + m.kcal;

    return JSON.stringify({
      since,
      goal: profile.goal,
      plannedSplit: plan?.splitName ?? null,
      workoutSessions: workouts.length,
      volumeByExercise,
      avgLoggedKcalPerDay:
        Object.keys(kcalByDate).length > 0
          ? Math.round(
              Object.values(kcalByDate).reduce((a, b) => a + b, 0) /
                Object.keys(kcalByDate).length
            )
          : null,
      kcalByDate,
    });
  },
  {
    name: "get_progress_data",
    description:
      "Returns the user's logged workouts (volume, best sets) and logged meals (daily kcal) for the last N days (default 14), plus goal and planned split. Use to review progress and adherence.",
    schema: z.object({ days: z.number().optional() }),
  }
);
