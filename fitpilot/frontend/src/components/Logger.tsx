import { useEffect, useMemo, useState } from "react";
import { get, post } from "../api";
import { SetEntry, Split, todayISO, WeeklyPlan, WorkoutLog } from "../types";

export default function Logger({
  plan,
  splits,
}: {
  plan: WeeklyPlan | null;
  splits: Split[];
}) {
  const today = plan?.days[todayISO()];
  const todayNames = useMemo(
    () => (today?.type === "workout" ? today.exercises.map((e) => e.name) : []),
    [today]
  );
  const allNames = useMemo(() => {
    const set = new Set<string>(todayNames);
    for (const s of splits) for (const d of s.days) for (const e of d.exercises) set.add(e.name);
    return Array.from(set);
  }, [splits, todayNames]);

  const [exercise, setExercise] = useState("");
  const [sets, setSets] = useState<SetEntry[]>([{ weight: 20, reps: 8 }]);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<WorkoutLog[]>([]);

  useEffect(() => {
    if (!exercise && allNames.length) setExercise(todayNames[0] ?? allNames[0]);
  }, [allNames, todayNames, exercise]);

  const loadLogs = () =>
    get<{ logs: WorkoutLog[] }>(`/logs/workout?since=${todayISO()}`)
      .then((r) => setLogs(r.logs))
      .catch(() => {});
  useEffect(() => {
    loadLogs();
  }, []);

  const videoUrl = useMemo(() => {
    for (const s of splits)
      for (const d of s.days)
        for (const e of d.exercises) if (e.name === exercise && e.url) return e.url;
    return null;
  }, [splits, exercise]);

  const update = (i: number, field: keyof SetEntry, value: number) =>
    setSets((s) => s.map((row, j) => (j === i ? { ...row, [field]: value } : row)));

  const save = async () => {
    setError("");
    setSaved("");
    try {
      await post("/logs/workout", { exercise, sets, date: todayISO() });
      setSaved(`${exercise}: ${sets.length} set${sets.length > 1 ? "s" : ""} saved.`);
      setSets([{ weight: sets[sets.length - 1]?.weight ?? 20, reps: 8 }]);
      loadLogs();
    } catch (e: any) {
      setError(e.message || "Could not save the log.");
    }
  };

  return (
    <div>
      <div className="card">
        <div className="plate-label">Log a workout · {todayISO()}</div>
        {todayNames.length > 0 && (
          <p className="small muted">Today's plan: {todayNames.join(" · ")}</p>
        )}
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="exercise">Exercise</label>
            <select id="exercise" value={exercise} onChange={(e) => setExercise(e.target.value)}>
              {todayNames.length > 0 && (
                <optgroup label="Today's session">
                  {todayNames.map((n) => (
                    <option key={`t-${n}`} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="All exercises">
                {allNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
        {videoUrl && (
          <p className="small">
            <a href={videoUrl} target="_blank" rel="noreferrer">
              ▶ Watch form guide
            </a>
          </p>
        )}

        {sets.map((s, i) => (
          <div className="set-row" key={i}>
            <span className="idx">Set {i + 1}</span>
            <div className="field">
              <label>kg</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={s.weight}
                onChange={(e) => update(i, "weight", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>reps</label>
              <input
                type="number"
                min={0}
                value={s.reps}
                onChange={(e) => update(i, "reps", Number(e.target.value))}
              />
            </div>
            {sets.length > 1 && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setSets((x) => x.filter((_, j) => j !== i))}
                aria-label={`Remove set ${i + 1}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            className="btn-ghost"
            onClick={() => setSets((s) => [...s, { ...s[s.length - 1] }])}
          >
            + Add set
          </button>
          <button className="btn" onClick={save} disabled={!exercise}>
            Save log
          </button>
        </div>
        {saved && <div className="notice">{saved}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <div className="plate-label">Logged today</div>
        {logs.length === 0 && <p className="muted">Nothing yet — go lift something.</p>}
        {logs.map((l, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <strong>{l.exercise}</strong>{" "}
            <span className="num small">
              {l.sets.map((s) => `${s.weight}×${s.reps}`).join("  ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
