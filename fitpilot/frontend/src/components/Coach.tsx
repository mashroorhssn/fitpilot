import { useEffect, useRef, useState } from "react";
import { post } from "../api";
import { TraceStep } from "../types";
import { TracePanel } from "./Shared";

interface Msg {
  role: "user" | "ai";
  text: string;
  trace?: TraceStep[];
}

function sessionId(): string {
  let id = sessionStorage.getItem("fitpilot-session");
  if (!id) {
    id = Math.random().toString(36).slice(2);
    sessionStorage.setItem("fitpilot-session", id);
  }
  return id;
}

const SUGGESTIONS = [
  "How busy is my week? When can I train?",
  "What should I eat around today's workout?",
  "How am I progressing toward my goal?",
  "What is RPE?",
];

export default function Coach() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setError("");
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const out = await post<{ reply: string; trace: TraceStep[] }>("/chat", {
        message,
        sessionId: sessionId(),
      });
      setMsgs((m) => [...m, { role: "ai", text: out.reply, trace: out.trace }]);
    } catch (e: any) {
      setError(e.message || "The coach is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="plate-label">Coach — orchestrator + 4 specialist agents</div>

      {msgs.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <p className="muted">
            Ask anything about your week, workouts, food or progress. The orchestrator delegates to
            ScheduleAnalyst, WorkoutPlanner, NutritionCoach or ProgressTracker — expand the trace
            under each answer to watch it happen.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn-ghost btn-sm" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat-box">
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div className={`msg ${m.role}`}>{m.text}</div>
            {m.role === "ai" && m.trace && <TracePanel trace={m.trace} />}
          </div>
        ))}
        {busy && <div className="msg ai muted">Agents at work…</div>}
        <div ref={bottom} />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="chat-input">
        <textarea
          rows={2}
          placeholder="e.g. Thursday got busier — move my leg day"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn" onClick={() => send()} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
