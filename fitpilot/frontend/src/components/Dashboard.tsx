import { useState } from "react";
import { post } from "../api";
import { todayISO, TraceStep, WeeklyPlan } from "../types";
import { TracePanel, WeekStrip } from "./Shared";

export default function Dashboard({
  plan,
  onPlanChange,
}: {
  plan: WeeklyPlan | null;
  onPlanChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<TraceStep[]>([]);

  const generate = async () => {
    setBusy(true);
    setError("");
    setTrace([]);
    try {
      const out = await post<{ plan: WeeklyPlan; trace: TraceStep[] }>("/plan/week");
      setTrace(out.trace);
      onPlanChange();
    } catch (e: any) {
      setError(e.message || "Plan generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const today = plan?.days[todayISO()];

  return (
    <div>
      <div className="card">
        <div className="plate-label">Today · {todayISO()}</div>
        {!plan && (
          <>
            <h1 className="h-big">No plan yet.</h1>
            <p className="muted">
              Ask the agent team to read your calendar, pick a split from the database, and build
              your training + meal week.
            </p>
          </>
        )}
        {plan && !today && (
          <>
            <h1 className="h-big">This plan doesn't cover today.</h1>
            <p className="muted">Generate a fresh week starting today.</p>
          </>
        )}
        {today && (
          <>
            <h1 className="h-big">
              {today.type === "workout" ? today.dayName : "Rest day"}
              {today.slot && <span className="muted"> · {today.slot}</span>}
            </h1>
            <div className="stats" style={{ margin: "14px 0 18px" }}>
              <div className="stat">
                <div className="v">{today.nutrition.calories}</div>
                <div className="k">kcal target</div>
              </div>
              <div className="stat">
                <div className="v">{today.nutrition.protein}g</div>
                <div className="k">protein</div>
              </div>
              <div className="stat">
                <div className="v">{today.nutrition.waterL}L</div>
                <div className="k">water</div>
              </div>
              <div className="stat">
                <div className="v">{today.workloadScore}/10</div>
                <div className="k">day workload</div>
              </div>
            </div>

            {today.type === "workout" && (
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>Exercise</th>
                    <th>Sets × reps</th>
                    <th>Effort</th>
                    <th>Guide</th>
                  </tr>
                </thead>
                <tbody>
                  {today.exercises.map((e) => (
                    <tr key={e.name}>
                      <td>
                        <strong>{e.name}</strong>
                        {e.notes && <div className="small muted">{e.notes}</div>}
                      </td>
                      <td className="num">
                        {e.sets} × {e.reps}
                      </td>
                      <td className="num">{e.rpe ?? "—"}</td>
                      <td>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">video</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {today.nutrition.meals.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="plate-label">Meals</div>
                {today.nutrition.meals.map((m) => (
                  <div key={m.name + m.time} style={{ marginBottom: 8 }}>
                    <span className="num">{m.time}</span> <strong>{m.name}</strong>{" "}
                    <span className="muted small">
                      ~{m.kcal} kcal · {m.items.join(", ")}
                    </span>
                  </div>
                ))}
                {today.nutrition.tip && <p className="small muted">Tip: {today.nutrition.tip}</p>}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={generate} disabled={busy}>
            {busy ? "Agents planning your week…" : plan ? "Regenerate my week" : "Generate my week"}
          </button>
          {busy && (
            <span className="small muted">
              ScheduleAnalyst → WorkoutPlanner → NutritionCoach (20–60s on free tier)
            </span>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        {trace.length > 0 && <TracePanel trace={trace} />}
      </div>

      {plan && (
        <div className="card">
          <WeekStrip plan={plan} />
          <p className="small muted" style={{ marginTop: 14 }}>
            <strong>Why this split:</strong> {plan.rationale}
          </p>
        </div>
      )}
    </div>
  );
}
