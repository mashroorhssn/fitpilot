import { useCallback, useEffect, useState } from "react";
import { get } from "./api";
import Coach from "./components/Coach";
import Dashboard from "./components/Dashboard";
import Logger from "./components/Logger";
import MealScan from "./components/MealScan";
import Progress from "./components/Progress";
import Settings from "./components/Settings";
import { Profile, Split, todayISO, WeeklyPlan } from "./types";

type Tab = "dashboard" | "coach" | "log" | "meals" | "progress" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "coach", label: "Coach" },
  { id: "log", label: "Log workout" },
  { id: "meals", label: "Meal scan" },
  { id: "progress", label: "Progress" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [apiDown, setApiDown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [p, pr, sp] = await Promise.all([
        get<{ plan: WeeklyPlan | null }>("/plan/current"),
        get<{ profile: Profile }>("/profile"),
        get<{ splits: Split[] }>("/splits"),
      ]);
      setPlan(p.plan);
      setProfile(pr.profile);
      setSplits(sp.splits);
      setApiDown(false);
    } catch {
      setApiDown(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 10pm in-browser notification (works while the tab is open; email covers the rest)
  useEffect(() => {
    const check = () => {
      if (!plan || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = new Date();
      if (now.getHours() !== 22) return;
      const key = `fitpilot-notified-${todayISO()}`;
      if (localStorage.getItem(key)) return;
      const tomorrow = new Date(now.getTime() + 86400000);
      const iso = new Intl.DateTimeFormat("en-CA").format(tomorrow);
      const day = plan.days[iso];
      const body = day
        ? day.type === "workout"
          ? `Tomorrow: ${day.dayName}${day.slot ? ` at ${day.slot}` : ""} · ~${day.nutrition.calories} kcal target`
          : `Tomorrow is a rest day · ~${day.nutrition.calories} kcal target`
        : "Generate next week's plan to see tomorrow.";
      new Notification("FitPilot — tomorrow's plan", { body });
      localStorage.setItem(key, "1");
    };
    const id = setInterval(check, 60_000);
    check();
    return () => clearInterval(id);
  }, [plan]);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="logo">
            FitPilot<span className="dot">.</span>
          </div>
          <div className="logo-sub">Your agent team for the training week</div>
        </div>
        <nav className="nav" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {apiDown && (
        <div className="error">
          Can't reach the FitPilot backend. Check that it's running and that VITE_API_URL points to
          it, then reload.
        </div>
      )}

      {tab === "dashboard" && <Dashboard plan={plan} onPlanChange={refresh} />}
      {tab === "coach" && <Coach />}
      {tab === "log" && <Logger plan={plan} splits={splits} />}
      {tab === "meals" && <MealScan />}
      {tab === "progress" && <Progress />}
      {tab === "settings" && profile && <Settings profile={profile} onSaved={refresh} />}
      {tab === "settings" && !profile && <div className="card">Loading profile…</div>}
    </div>
  );
}
