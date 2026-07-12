import fs from "fs";
import path from "path";
import { ENV } from "../config/env";

// data/ sits next to src/ and dist/, so ../../data works in dev and prod
const DATA_DIR = path.resolve(__dirname, "../../data");

// ---------- Types ----------
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
export interface SplitDay {
  day: string;
  exercises: Exercise[];
}
export interface Split {
  id: string;
  name: string;
  daysPerWeek: number;
  sessionMinutes: number;
  focus: string[];
  description: string;
  days: SplitDay[];
}
export interface CalEvent {
  date: string; // YYYY-MM-DD
  title: string;
  start: string; // HH:MM
  end: string;
  type: string;
}
export interface DayAnalysis {
  date: string;
  weekday: string;
  events: CalEvent[];
  busyHours: number;
  workloadScore: number; // 0-10
  freeWindows: { start: string; end: string; minutes: number }[];
}

// ---------- Splits ----------
let splitsCache: Split[] | null = null;
export function getSplits(): Split[] {
  if (!splitsCache) {
    const raw = fs.readFileSync(path.join(DATA_DIR, "splits.json"), "utf8");
    splitsCache = (JSON.parse(raw) as { splits: Split[] }).splits;
  }
  return splitsCache;
}
export function getSplitById(id: string): Split | undefined {
  return getSplits().find((s) => s.id === id);
}
export function splitsMetadata() {
  return getSplits().map((s) => ({
    id: s.id,
    name: s.name,
    daysPerWeek: s.daysPerWeek,
    sessionMinutes: s.sessionMinutes,
    focus: s.focus,
    description: s.description,
    dayNames: s.days.map((d) => d.day),
  }));
}

// ---------- Dates (all in the app timezone) ----------
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ENV.TIMEZONE }).format(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekdayOf(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}
function weekParity(iso: string): "even" | "odd" {
  const days = Math.floor(new Date(iso + "T12:00:00Z").getTime() / 86400000);
  return Math.floor(days / 7) % 2 === 0 ? "even" : "odd";
}

// ---------- Calendar ----------
interface CalendarTemplate {
  owner: Record<string, string>;
  weekly: Record<string, Omit<CalEvent, "date">[]>;
  altWeeks?: Record<"even" | "odd", Record<string, Omit<CalEvent, "date">[]>>;
}

async function loadCalendarTemplate(): Promise<{ template: CalendarTemplate; source: string }> {
  if (ENV.CALENDAR_URL) {
    try {
      const res = await fetch(ENV.CALENDAR_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { template: (await res.json()) as CalendarTemplate, source: ENV.CALENDAR_URL };
    } catch (e: any) {
      console.warn(`[calendar] CALENDAR_URL failed (${e?.message}); using bundled template`);
    }
  }
  const raw = fs.readFileSync(path.join(DATA_DIR, "calendar.json"), "utf8");
  return { template: JSON.parse(raw) as CalendarTemplate, source: "bundled data/calendar.json" };
}

/** Materializes the recurring template into dated events for 7 days from weekStart. */
export async function fetchWeekEvents(
  weekStart: string
): Promise<{ events: CalEvent[]; owner: Record<string, string>; source: string }> {
  const { template, source } = await loadCalendarTemplate();
  const events: CalEvent[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const wd = weekdayOf(date);
    const base = template.weekly[wd] ?? [];
    const alt = template.altWeeks?.[weekParity(date)]?.[wd] ?? [];
    for (const ev of [...base, ...alt]) events.push({ date, ...ev });
  }
  return { events, owner: template.owner, source };
}

// ---------- Deterministic workload analysis (pure code, no LLM) ----------
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const DAY_OPEN = toMin("06:30");
const DAY_CLOSE = toMin("22:30");

export function analyzeWeek(weekStart: string, events: CalEvent[]): DayAnalysis[] {
  const out: DayAnalysis[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dayEvents = events
      .filter((e) => e.date === date)
      .sort((a, b) => toMin(a.start) - toMin(b.start));

    const busyMin = dayEvents.reduce((s, e) => s + (toMin(e.end) - toMin(e.start)), 0);
    // 0 busy hours -> 0 ; 12+ busy hours -> 10
    const workloadScore = Math.min(10, Math.round((busyMin / 60 / 12) * 10));

    const freeWindows: DayAnalysis["freeWindows"] = [];
    let ptr = DAY_OPEN;
    for (const e of dayEvents) {
      const s = Math.max(toMin(e.start), DAY_OPEN);
      if (s - ptr >= 45) freeWindows.push({ start: toHHMM(ptr), end: toHHMM(s), minutes: s - ptr });
      ptr = Math.max(ptr, toMin(e.end));
    }
    if (DAY_CLOSE - ptr >= 45)
      freeWindows.push({ start: toHHMM(ptr), end: toHHMM(DAY_CLOSE), minutes: DAY_CLOSE - ptr });

    out.push({
      date,
      weekday: weekdayOf(date),
      events: dayEvents,
      busyHours: Math.round((busyMin / 60) * 10) / 10,
      workloadScore,
      freeWindows,
    });
  }
  return out;
}

/** Compact view of the analysis for LLM prompts (saves tokens). */
export function compactAnalysis(days: DayAnalysis[]) {
  return days.map((d) => ({
    date: d.date,
    weekday: d.weekday,
    busyHours: d.busyHours,
    workloadScore: d.workloadScore,
    events: d.events.map((e) => `${e.start}-${e.end} ${e.title}`),
    freeWindows: d.freeWindows.map((w) => `${w.start}-${w.end} (${w.minutes}m)`),
  }));
}
