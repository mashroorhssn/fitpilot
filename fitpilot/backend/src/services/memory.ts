import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Short-term conversational memory, per browser session.
 * (Long-term memory = the profile, plans and logs persisted in the store.)
 */
interface Turn {
  role: "human" | "ai";
  content: string;
}

const sessions = new Map<string, Turn[]>();
const MAX_TURNS = 12;

export function getHistory(sessionId: string): BaseMessage[] {
  const turns = sessions.get(sessionId) ?? [];
  return turns.map((t) =>
    t.role === "human" ? new HumanMessage(t.content) : new AIMessage(t.content)
  );
}

export function remember(sessionId: string, human: string, ai: string): void {
  const turns = sessions.get(sessionId) ?? [];
  turns.push({ role: "human", content: human }, { role: "ai", content: ai });
  while (turns.length > MAX_TURNS) turns.shift();
  sessions.set(sessionId, turns);
}
