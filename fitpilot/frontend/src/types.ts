export interface TraceStep {
  agent: string;
  kind: "llm" | "tool";
  label: string;
  detail: string;
  ms: number;
}

export interface Exercise {
  name: string;
  url: string | null;
  sets: string;
  reps: string;
  rpe: string | null;
  rest: string | null;
  notes: string | null;
  subs: { name: string; url: string | null }[];
}

export interface Meal {
  name: string;
  time: string;
  items: string[];
  kcal: number;
}

export interface PlanDay {
  type: "workout" | "rest";
  dayName: string | null;
  slot: string | null;
  note: string | null;
  weekday: string;
  workloadScore: number;
  exercises: Exercise[];
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    waterL: number;
    meals: Meal[];
    tip: string | null;
  };
}

export interface WeeklyPlan {
  weekStart: string;
  splitId: string;
  splitName: string;
  rationale: string;
  days: Record<string, PlanDay>;
  createdAt: string;
}

export interface Profile {
  name: string;
  age: number;
  sex: "male" | "female";
  heightCm: number;
  weightKg: number;
  goal: "muscle_building" | "weight_loss" | "strength_gain" | "maintenance";
  email?: string;
}

export interface Split {
  id: string;
  name: string;
  daysPerWeek: number;
  sessionMinutes: number;
  focus: string[];
  description: string;
  days: { day: string; exercises: Exercise[] }[];
}

export interface SetEntry {
  weight: number;
  reps: number;
}

export interface WorkoutLog {
  date: string;
  exercise: string;
  sets: SetEntry[];
  note?: string;
}

export interface MealLog {
  date: string;
  name: string;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  items?: string[];
  source: "manual" | "photo";
}

export interface MealEstimate {
  mealName: string;
  items: { name: string; portion: string; kcal: number }[];
  totalKcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: "low" | "medium" | "high";
  notes: string;
}

export interface DayAnalysis {
  date: string;
  weekday: string;
  events: { date: string; title: string; start: string; end: string; type: string }[];
  busyHours: number;
  workloadScore: number;
  freeWindows: { start: string; end: string; minutes: number }[];
}

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export function sortedDays(plan: WeeklyPlan): [string, PlanDay][] {
  return Object.entries(plan.days).sort(([a], [b]) => (a < b ? -1 : 1));
}
