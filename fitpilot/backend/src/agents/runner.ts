import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { ENV } from "../config/env";
import { makeModel, MODELS, Tier, withKeyRotation } from "../llm/models";
import { todayISO, weekdayOf } from "../services/dataFiles";

/**
 * A single, explainable ReAct-style loop used by EVERY agent in the system:
 *   1. model reasons over the messages (LangChain chat model bound to tools)
 *   2. if it requested tools -> execute them, append observations, repeat
 *   3. if it answered in plain text -> done
 * Every step is appended to a trace so the UI (and the professor) can see
 * exactly which agent called which tool with what result.
 */

export interface TraceStep {
  agent: string;
  kind: "llm" | "tool";
  label: string;
  detail: string;
  ms: number;
}

export interface AgentConfig {
  name: string;
  tier: Tier;
  system: string;
  tools: StructuredToolInterface[];
  maxIterations?: number;
  temperature?: number;
}

const trunc = (s: string, n = 500) => (s.length > n ? s.slice(0, n) + " …" : s);

export function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
      .join("");
  return String(content ?? "");
}

export async function runAgent(
  cfg: AgentConfig,
  input: string,
  history: BaseMessage[] = [],
  trace: TraceStep[] = []
): Promise<string> {
  const today = todayISO();
  const messages: BaseMessage[] = [
    new SystemMessage(
      `Today is ${today} (${weekdayOf(today)}, timezone ${ENV.TIMEZONE}).\n${cfg.system}`
    ),
    ...history,
    new HumanMessage(input),
  ];
  const toolMap = new Map(cfg.tools.map((t) => [t.name, t]));
  const maxIter = cfg.maxIterations ?? 6;

  for (let i = 0; i < maxIter; i++) {
    const t0 = Date.now();
    const ai = (await withKeyRotation(async () => {
      const model = makeModel(cfg.tier, cfg.temperature ?? 0.2);
      const runnable = cfg.tools.length ? model.bindTools(cfg.tools) : model;
      return await runnable.invoke(messages);
    })) as AIMessage;

    const calls = ai.tool_calls ?? [];
    trace.push({
      agent: cfg.name,
      kind: "llm",
      label: calls.length
        ? `${cfg.name} decided to call: ${calls.map((c) => c.name).join(", ")}`
        : `${cfg.name} answered (${MODELS[cfg.tier]})`,
      detail: trunc(contentToString(ai.content) || "(tool call)"),
      ms: Date.now() - t0,
    });
    messages.push(ai);

    if (!calls.length) return contentToString(ai.content);

    for (const call of calls) {
      const tool = toolMap.get(call.name);
      const t1 = Date.now();
      let result: string;
      try {
        result = tool
          ? String(await tool.invoke(call.args ?? {}))
          : `ERROR: unknown tool "${call.name}"`;
      } catch (e: any) {
        result = `TOOL_ERROR: ${e?.message ?? e}`;
      }
      trace.push({
        agent: cfg.name,
        kind: "tool",
        label: `tool: ${call.name}`,
        detail: trunc(result),
        ms: Date.now() - t1,
      });
      messages.push(
        new ToolMessage({ content: result, tool_call_id: call.id ?? call.name })
      );
    }
  }
  return "I hit my reasoning step limit for this request — try asking in a more specific way.";
}

/** Robust JSON extraction from an LLM reply (strips fences, grabs outer braces). */
export function extractJson<T = any>(text: string): T {
  let t = text.trim().replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as T;
}
