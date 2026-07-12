import { PlanDay, sortedDays, todayISO, TraceStep, WeeklyPlan } from "../types";

/* ---------- Agent execution trace (the demo's explainability panel) ---------- */
export function TracePanel({ trace }: { trace: TraceStep[] }) {
  if (!trace?.length) return null;
  return (
    <details className="trace">
      <summary>How the agents worked — {trace.length} steps</summary>
      <div className="trace-steps">
        {trace.map((s, i) => (
          <div className="trace-step" key={i}>
            <div className={s.kind === "tool" ? "kind-tool" : "kind-llm"}>
              <span className="who">{s.kind === "tool" ? "⚙ " : "◆ "}{s.label}</span>{" "}
              <span className="ms">{s.ms}ms</span>
            </div>
            {s.detail && <div className="detail">{s.detail}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}

/* ---------- Week strip: 7 day cells with workload meters ---------- */
function meterClass(score: number): string {
  if (score >= 7) return "on-high";
  if (score >= 4) return "on-mid";
  return "on-low";
}

function DayCell({ date, day }: { date: string; day: PlanDay }) {
  const isToday = date === todayISO();
  const bars = Array.from({ length: 10 }, (_, i) => i < day.workloadScore);
  return (
    <div className={`day-cell${isToday ? " today" : ""}`}>
      <div>
        <div className="wd">{day.weekday}</div>
        <div className="dt">{date.slice(5)}</div>
      </div>
      {day.type === "workout" ? (
        <span className="chip chip-train">{day.dayName}</span>
      ) : (
        <span className="chip chip-rest">Rest</span>
      )}
      {day.slot && <div className="slot">{day.slot}</div>}
      <div className="meter" title={`Workload ${day.workloadScore}/10`}>
        {bars.map((on, i) => (
          <i key={i} className={on ? meterClass(day.workloadScore) : ""} style={{ height: `${25 + i * 7.5}%` }} />
        ))}
      </div>
      <div className="meter-label">load {day.workloadScore}/10</div>
    </div>
  );
}

export function WeekStrip({ plan }: { plan: WeeklyPlan }) {
  return (
    <div>
      <div className="plate-label">Week of {plan.weekStart} — {plan.splitName}</div>
      <div className="week-strip">
        {sortedDays(plan).map(([date, day]) => (
          <DayCell key={date} date={date} day={day} />
        ))}
      </div>
    </div>
  );
}
