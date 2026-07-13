import fs from "fs";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config/env";

/**
 * Uniform persistence API. Uses Supabase (Postgres) when SUPABASE_URL is set;
 * otherwise falls back to a local JSON file so the app runs with zero setup.
 * (Fail-safe design: a dead database never kills the demo.)
 */

export interface Profile {
  name: string;
  age: number;
  sex: "male" | "female";
  heightCm: number;
  weightKg: number;
  goal: "muscle_building" | "weight_loss" | "strength_gain" | "maintenance";
  email?: string;
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
export interface WeeklyPlan {
  weekStart: string;
  splitId: string;
  splitName: string;
  rationale: string;
  days: Record<string, any>;
  createdAt: string;
}

const DEFAULT_PROFILE: Profile = {
  name: "Arif Hasan",
  age: 24,
  sex: "male",
  heightCm: 172,
  weightKg: 70,
  goal: "muscle_building",
};

// ---------- Local JSON fallback ----------
const DB_PATH = path.resolve(__dirname, "../../data/localdb.json");
interface LocalDB {
  profile: Profile;
  plans: WeeklyPlan[];
  workout_logs: WorkoutLog[];
  meal_logs: MealLog[];
}
function readLocal(): LocalDB {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as LocalDB;
  } catch {
    return { profile: { ...DEFAULT_PROFILE }, plans: [], workout_logs: [], meal_logs: [] };
  }
}
function writeLocal(db: LocalDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 1));
}

// ---------- Supabase ----------
let sb: SupabaseClient | null = null;
if (ENV.SUPABASE_URL && ENV.SUPABASE_KEY) {
  sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_KEY);
}
export const storageMode = sb ? "supabase" : "local-json";

async function sbGetAll<T>(table: string): Promise<T[]> {
  const { data, error } = await sb!.from(table).select("data").order("id", { ascending: true });
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return (data ?? []).map((r: any) => r.data as T);
}

// ---------- Public API ----------
export async function getProfile(): Promise<Profile> {
  if (sb) {
    const { data } = await sb.from("profile").select("data").eq("id", 1).maybeSingle();
    return (data?.data as Profile) ?? { ...DEFAULT_PROFILE };
  }
  return readLocal().profile;
}

export async function saveProfile(p: Profile): Promise<void> {
  if (sb) {
    await sb.from("profile").upsert({ id: 1, data: p });
    return;
  }
  const db = readLocal();
  db.profile = p;
  writeLocal(db);
}

export async function saveWeeklyPlan(plan: WeeklyPlan): Promise<void> {
  if (sb) {
    await sb.from("plans").upsert({ week_start: plan.weekStart, data: plan });
    return;
  }
  const db = readLocal();
  db.plans = db.plans.filter((p) => p.weekStart !== plan.weekStart);
  db.plans.push(plan);
  writeLocal(db);
}

export async function getLatestPlan(): Promise<WeeklyPlan | null> {
  if (sb) {
    const { data } = await sb
      .from("plans")
      .select("data")
      .order("week_start", { ascending: false })
      .limit(1);
    return (data?.[0]?.data as WeeklyPlan) ?? null;
  }
  const plans = readLocal().plans.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  return plans[0] ?? null;
}

export async function addWorkoutLog(log: WorkoutLog): Promise<void> {
  if (sb) {
    await sb.from("workout_logs").insert({ data: log });
    return;
  }
  const db = readLocal();
  db.workout_logs.push(log);
  writeLocal(db);
}

export async function getWorkoutLogs(sinceISO?: string): Promise<WorkoutLog[]> {
  const all = sb ? await sbGetAll<WorkoutLog>("workout_logs") : readLocal().workout_logs;
  return sinceISO ? all.filter((l) => l.date >= sinceISO) : all;
}

export async function addMealLog(log: MealLog): Promise<void> {
  if (sb) {
    await sb.from("meal_logs").insert({ data: log });
    return;
  }
  const db = readLocal();
  db.meal_logs.push(log);
  writeLocal(db);
}

export async function getMealLogs(sinceISO?: string): Promise<MealLog[]> {
  const all = sb ? await sbGetAll<MealLog>("meal_logs") : readLocal().meal_logs;
  return sinceISO ? all.filter((l) => l.date >= sinceISO) : all;
}
