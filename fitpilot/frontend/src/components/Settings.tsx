import { useState } from "react";
import { apiBase, post } from "../api";
import { Profile } from "../types";

export default function Settings({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Profile>(profile);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [notif, setNotif] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaved("");
    setError("");
    try {
      await post("/profile", form);
      setSaved("Profile saved. New plans will use these numbers.");
      onSaved();
    } catch (e: any) {
      setError(e.message || "Could not save.");
    }
  };

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotif(p);
    if (p === "granted")
      new Notification("FitPilot notifications on", {
        body: "While this tab is open, you'll get tomorrow's plan at 10pm.",
      });
  };

  return (
    <div>
      <div className="card">
        <div className="plate-label">Profile — drives nutrition math and planning</div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="age">Age</label>
            <input id="age" type="number" value={form.age} onChange={(e) => set("age", Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="sex">Sex</label>
            <select id="sex" value={form.sex} onChange={(e) => set("sex", e.target.value as Profile["sex"]) }>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="height">Height (cm)</label>
            <input id="height" type="number" value={form.heightCm} onChange={(e) => set("heightCm", Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="weight">Weight (kg)</label>
            <input id="weight" type="number" value={form.weightKg} onChange={(e) => set("weightKg", Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="goal">Goal</label>
            <select id="goal" value={form.goal} onChange={(e) => set("goal", e.target.value as Profile["goal"]) }>
              <option value="muscle_building">Build muscle</option>
              <option value="strength_gain">Gain strength</option>
              <option value="weight_loss">Lose weight</option>
              <option value="maintenance">Maintain</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="email">Email (for the 10pm digest)</label>
            <input id="email" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>
        <button className="btn" style={{ marginTop: 16 }} onClick={save}>
          Save profile
        </button>
        {saved && <div className="notice">{saved}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <div className="plate-label">Nightly plan delivery</div>
        <p className="small">
          <strong>Email (10:00 PM):</strong> a scheduler calls the backend every night, which emails
          tomorrow's workout and meals. Configure SMTP_USER / SMTP_PASS / EMAIL_TO on the backend and
          point cron-job.org at <span className="mono">{apiBase}/api/jobs/nightly-digest</span>.
        </p>
        <p className="small">
          <strong>Browser notification:</strong> works while this tab is open — you'll get a ping at
          10pm with tomorrow's session.
        </p>
        <button
          className="btn-ghost"
          onClick={enableNotifications}
          disabled={notif === "granted" || notif === "unsupported"}
        >
          {notif === "granted"
            ? "Notifications enabled ✓"
            : notif === "unsupported"
            ? "Not supported in this browser"
            : "Enable browser notifications"}
        </button>
      </div>
    </div>
  );
}
