import { useEffect, useMemo, useState } from "react";
import { get, post } from "../api";
import { MealLog, TraceStep, WorkoutLog } from "../types";
import { TracePanel } from "./Shared";

function daysAgoISO(n: number): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date(Date.now() - n * 86400000));
}

export default function Progress() {
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [review, setReview] = useState("");
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const since = daysAgoISO(13);
    get<{ logs: WorkoutLog[] }>(`/logs/workout?since=${since}`)
      .then((r) => setWorkouts(r.logs))
      .catch(() => {});
    get<{ logs: MealLog[] }>(`/logs/meals?since=${since}`)
      .then((r) => setMeals(r.logs))
      .catch(() => {});
  }, []);

  const { volumeByDate, kcalByDate, maxVol, maxKcal } = useMemo(() => {
    const volumeByDate: Record<string, number> = {};
    for (const w of workouts)
      volumeByDate[w.date] =
        (volumeByDate[w.date] ?? 0) + w.sets.reduce((s, x) => s + x.weight * x.reps, 0);
    const kcalByDate: Record<string, number> = {};
    for (const m of meals) kcalByDate[m.date] = (kcalByDate[m.date] ?? 0) + m.kcal;
    return {
      volumeByDate,
      kcalByDate,
      maxVol: Math.max(1, ...Object.values(volumeByDate)),
      maxKcal: Math.max(1, ...Object.values(kcalByDate)),
    };
  }, [workouts, meals]);

  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => daysAgoISO(13 - i)), []);

  const runReview = async () => {
    setBusy(true);
    setError("");
    setReview("");
    setTrace([]);
    try {
      const out = await post<{ reply: string; trace: TraceStep[] }>("/progress/review");
      setReview(out.reply);
      setTrace(out.trace);
    } catch (e: any) {
      setError(e.message || "Review failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="plate-label">Training volume — last 14 days (kg × reps)</div>
        {Object.keys(volumeByDate).length === 0 && (
          <p className="muted">No workout logs yet. Log a session and this fills in.</p>
        )}
        {dates.map((d) =>
          volumeByDate[d] ? (
            <div className="bar-row" key={d}>
              <span className="lbl">{d.slice(5)}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(volumeByDate[d] / maxVol) * 100}%` }} />
              </div>
              <span className="num small">{Math.round(volumeByDate[d])}</span>
            </div>
          ) : null
        )}
      </div>

      <div className="card">
        <div className="plate-label">Logged calories — last 14 days</div>
        {Object.keys(kcalByDate).length === 0 && (
          <p className="muted">No meal logs yet. Scan or log a meal to start tracking.</p>
        )}
        {dates.map((d) =>
          kcalByDate[d] ? (
            <div className="bar-row" key={d}>
              <span className="lbl">{d.slice(5)}</span>
              <div className="bar-track">
                <div
                  className="bar-fill meal"
                  style={{ width: `${(kcalByDate[d] / maxKcal) * 100}%` }}
                />
              </div>
              <span className="num small">{kcalByDate[d]} kcal</span>
            </div>
          ) : null
        )}
      </div>

      <div className="card">
        <div className="plate-label">ProgressTracker agent</div>
        <p className="muted small">
          The agent reads your logs, compares them with the plan and your goal, and suggests
          concrete adjustments.
        </p>
        <button className="btn" onClick={runReview} disabled={busy}>
          {busy ? "Reviewing your last 14 days…" : "Run progress review"}
        </button>
        {error && <div className="error">{error}</div>}
        {review && (
          <div style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>
            {review}
            <TracePanel trace={trace} />
          </div>
        )}
      </div>
    </div>
  );
}
