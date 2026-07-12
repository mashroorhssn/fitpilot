import { useState } from "react";
import { post } from "../api";
import { MealEstimate, todayISO } from "../types";

export default function MealScan() {
  const [preview, setPreview] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<MealEstimate | null>(null);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState("");

  const onFile = (f: File | undefined) => {
    setEstimate(null);
    setLogged("");
    setError("");
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      setError("Image is too large — keep it under 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(f);
  };

  const analyze = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    setEstimate(null);
    setLogged("");
    try {
      const out = await post<{ estimate: MealEstimate; disclaimer: string }>("/meal/analyze", {
        imageBase64: preview,
        hint: hint || undefined,
      });
      setEstimate(out.estimate);
    } catch (e: any) {
      setError(e.message || "Analysis failed — try a clearer photo.");
    } finally {
      setBusy(false);
    }
  };

  const log = async () => {
    if (!estimate) return;
    try {
      await post("/meal/log", {
        date: todayISO(),
        name: estimate.mealName,
        kcal: estimate.totalKcal,
        protein: estimate.protein,
        carbs: estimate.carbs,
        fat: estimate.fat,
        items: estimate.items.map((i) => `${i.name} (${i.portion})`),
        source: "photo",
      });
      setLogged(`Logged: ${estimate.mealName} — ~${estimate.totalKcal} kcal.`);
    } catch (e: any) {
      setError(e.message || "Could not log the meal.");
    }
  };

  return (
    <div className="card">
      <div className="plate-label">Meal scan — vision model calorie estimate</div>
      <p className="muted small">
        Snap your plate; the vision agent identifies the food and estimates calories and macros.
        Estimates are rough (±30%) — treat them as a guide, not a lab report.
      </p>

      <div className="form-grid" style={{ margin: "14px 0" }}>
        <div className="field">
          <label htmlFor="photo">Photo</label>
          <input
            id="photo"
            type="file"
            accept="image/*"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <div className="field">
          <label htmlFor="hint">Hint (optional)</label>
          <input
            id="hint"
            type="text"
            placeholder="e.g. chicken bhuna with 1 cup rice"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </div>
      </div>

      {preview && <img src={preview} alt="Meal preview" className="scan-preview" />}

      <div style={{ marginTop: 14 }}>
        <button className="btn" onClick={analyze} disabled={!preview || busy}>
          {busy ? "Vision agent looking at your plate…" : "Estimate calories"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {estimate && (
        <div style={{ marginTop: 18 }}>
          <h2 className="h-mid">
            {estimate.mealName}{" "}
            <span className="chip chip-soft">confidence: {estimate.confidence}</span>
          </h2>
          <div className="stats" style={{ margin: "10px 0 14px" }}>
            <div className="stat">
              <div className="v">{estimate.totalKcal}</div>
              <div className="k">kcal</div>
            </div>
            <div className="stat">
              <div className="v">{estimate.protein}g</div>
              <div className="k">protein</div>
            </div>
            <div className="stat">
              <div className="v">{estimate.carbs}g</div>
              <div className="k">carbs</div>
            </div>
            <div className="stat">
              <div className="v">{estimate.fat}g</div>
              <div className="k">fat</div>
            </div>
          </div>
          {estimate.items.map((i) => (
            <div key={i.name} className="small">
              • {i.name} — {i.portion} <span className="num">~{i.kcal} kcal</span>
            </div>
          ))}
          {estimate.notes && <p className="small muted">{estimate.notes}</p>}
          <button className="btn" style={{ marginTop: 12 }} onClick={log}>
            Log this meal
          </button>
          {logged && <div className="notice">{logged}</div>}
        </div>
      )}
    </div>
  );
}
