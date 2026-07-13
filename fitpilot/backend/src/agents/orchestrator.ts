import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getHistory, remember } from "../services/memory";
import { getLatestPlan, getProfile } from "../services/store";
import { todayISO } from "../services/dataFiles";
import { nutritionAgent, progressAgent, scheduleAgent, workoutAgent } from "./agents";
import { AgentConfig, runAgent, TraceStep } from "./runner";
import { getCurrentPlanTool } from "./tools";

/**
 * Supervisor-worker orchestration ("agents as tools"):
 * the Orchestrator is itself a LangChain tool-calling agent whose tools ARE
 * the specialist agents. Delegation appears in the trace as a tool call,
 * which makes the whole system explainable during the demo.
 */

const request = z.object({
  request: z
    .string()
    .describe("A clear, self-contained instruction for the specialist, including any needed context."),
});

function agentAsTool(cfg: AgentConfig, description: string, trace: TraceStep[]) {
  return tool(
    async ({ request }: { request: string }) => runAgent(cfg, request, [], trace),
    { name: cfg.name, description, schema: request }
  );
}

export async function chatWithOrchestrator(
  sessionId: string,
  message: string
): Promise<{ reply: string; trace: TraceStep[] }> {
  const trace: TraceStep[] = [];
  const [profile, plan] = await Promise.all([getProfile(), getLatestPlan()]);

  const planSummary = plan
    ? `Current plan (week of ${plan.weekStart}): ${plan.splitName}. Training days: ${Object.entries(
        plan.days
      )
        .filter(([, d]: [string, any]) => d.type === "workout")
        .map(([date, d]: [string, any]) => `${date} ${d.dayName}`)
        .join(", ")}.`
    : "No weekly plan has been generated yet.";

  const orchestrator: AgentConfig = {
    name: "Orchestrator",
    tier: "smart",
    maxIterations: 6,
    tools: [
      getCurrentPlanTool,
      agentAsTool(
        scheduleAgent,
        "Delegate calendar/schedule questions: what the week looks like, free time, busiest days.",
        trace
      ),
      agentAsTool(
        workoutAgent,
        "Delegate workout planning: choosing/adjusting the weekly split, moving sessions, exercise substitutions.",
        trace
      ),
      agentAsTool(
        nutritionAgent,
        "Delegate food questions: meal plans, calories, macros, water intake, what to eat around a session.",
        trace
      ),
      agentAsTool(
        progressAgent,
        "Delegate progress review: how training/eating is going vs the goal, what to improve.",
        trace
      ),
    ],
    system: `You are FitPilot, the coordinator of a multi-agent AI fitness team.
Today is ${todayISO()} (timezone Asia/Dhaka).
User profile: ${JSON.stringify(profile)}
${planSummary}

Routing rules:
- Simple factual fitness questions (e.g. "what is RPE?", "is soreness normal?") -> answer directly, NO tools.
- Anything about the user's calendar/time -> ScheduleAnalyst.
- Anything about choosing or changing the workout plan/split -> WorkoutPlanner.
- Anything about food, calories, macros, water -> NutritionCoach.
- "How am I doing / review my week / should I change something" -> ProgressTracker (it may recommend changes; relay them and offer to apply via WorkoutPlanner or NutritionCoach).
- Quick lookups about the saved plan -> get_current_plan.
- If the request is ambiguous (e.g. "make it harder" with no context), ask ONE short clarifying question instead of guessing.

Style: warm, concise, specific. Never invent calendar events, exercises or numbers — specialists and tools are the source of truth. If a tool fails, say so plainly and suggest what to do. General fitness guidance only; recommend a doctor/physio for pain or medical issues.`,
  };

  const history = getHistory(sessionId);
  const reply = await runAgent(orchestrator, message, history, trace);
  remember(sessionId, message, reply);
  return { reply, trace };
}
