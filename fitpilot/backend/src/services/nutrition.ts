/**
 * Deterministic nutrition math (Mifflin-St Jeor). The LLM decides *what to eat*;
 * this code decides *how much*. Numbers from code are ground truth and always
 * override anything the model writes.
 */
import { Profile } from "./store";

export interface DayTargets {
  calories: number;
  protein: number; // g
  carbs: number; // g
  fat: number; // g
  waterL: number;
}

export function calcDayTargets(
  profile: Profile,
  opts: { trainingMinutes: number; workloadScore: number }
): DayTargets {
  const { weightKg: w, heightCm: h, age, sex, goal } = profile;
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161);

  const exerciseKcal = opts.trainingMinutes * 6; // moderate resistance training
  const neatBump = opts.workloadScore * 15; // busier day -> more incidental movement
  let tdee = bmr * 1.4 + exerciseKcal + neatBump;

  const goalAdj: Record<Profile["goal"], number> = {
    weight_loss: -0.2,
    muscle_building: 0.1,
    strength_gain: 0.05,
    maintenance: 0,
  };
  const calories = Math.round((tdee * (1 + goalAdj[goal])) / 10) * 10;

  const proteinPerKg: Record<Profile["goal"], number> = {
    weight_loss: 2.2,
    muscle_building: 2.0,
    strength_gain: 1.8,
    maintenance: 1.6,
  };
  const protein = Math.round(w * proteinPerKg[goal]);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  const waterL =
    Math.round(
      (0.035 * w + 0.6 * (opts.trainingMinutes / 60) + (opts.workloadScore >= 7 ? 0.25 : 0)) * 10
    ) / 10;

  return { calories, protein, carbs, fat, waterL };
}
