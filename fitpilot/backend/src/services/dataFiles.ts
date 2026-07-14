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

/**
 * People paste all kinds of Gist URLs. Normalize them to a raw URL that
 * always serves the LATEST revision as JSON:
 *   gist.github.com/{user}/{id}            -> gist.githubusercontent.com/{user}/{id}/raw
 *   .../raw/{40-char commit hash}/file.json -> .../raw/file.json  (unpin the revision)
 */
export function normalizeCalendarUrl(url: string): string {
  let u = url.trim();
  const page = u.match(/^https?:\/\/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i);
  if (page) return `https://gist.githubusercontent.com/${page[1]}/${page[2]}/raw`;
  // Drop a pinned revision hash so mid-demo edits to the Gist show up.
  u = u.replace(/\/raw\/[a-f0-9]{40}(\/|$)/i, "/raw$1");
  return u;
}

/** Last calendar fetch status — surfaced on /api/health so a broken
 *  CALENDAR_URL is visible instead of silently falling back. */
export const calendarStatus = {
  configuredUrl: ENV.CALENDAR_URL || null as string | null,
  normalizedUrl: ENV.CALENDAR_URL ? normalizeCalendarUrl(ENV.CALENDAR_URL) : null,
  lastSource: "never fetched yet",
  lastError: null as string | null,
  lastFetchedAt: null as string | null,
};

function isValidTemplate(t: any): t is CalendarTemplate {
  return t && typeof t === "object" && t.weekly && typeof t.weekly === "object";
}

async function loadCalendarTemplate(): Promise<{ template: CalendarTemplate; source: string }> {
  calendarStatus.lastFetchedAt = new Date().toISOString();
  if (ENV.CALENDAR_URL) {
    const url = normalizeCalendarUrl(ENV.CALENDAR_URL);
    try {
      // Cache-buster: gist raw content is CDN-cached for ~5 min otherwise.
      const bust = url.includes("?") ? `&t=${Date.now()}` : `?t=${Date.now()}`;
      const res = await fetch(url + bust, {
        headers: { Accept: "application/json, text/plain" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          text.trimStart().startsWith("<")
            ? "URL returned HTML, not JSON — use the Gist's RAW url (gist.githubusercontent.com/...)"
            : "response is not valid JSON"
        );
      }
      if (!isValidTemplate(parsed))
        throw new Error('JSON is missing the "weekly" object — is this the calendar file?');
      calendarStatus.lastSource = url;
      calendarStatus.lastError = null;
      return { template: parsed, source: url };
    } catch (e: any) {
      calendarStatus.lastError = String(e?.message ?? e);
      console.warn(`[calendar] CALENDAR_URL failed (${calendarStatus.lastError}); using bundled template`);
    }
  }
  const raw = fs.readFileSync(path.join(DATA_DIR, "calendar.json"), "utf8");
  calendarStatus.lastSource = "bundled data/calendar.json (fallback)";
  return { template: JSON.parse(raw) as CalendarTemplate, source: calendarStatus.lastSource };
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
