import { Router, Request, Response } from "express";
import { chatWithOrchestrator } from "../agents/orchestrator";
import { generateWeeklyPlan } from "../agents/pipeline";
import { progressAgent } from "../agents/agents";
import { runAgent, TraceStep } from "../agents/runner";
import {
  analyzeWeek,
  calendarStatus,
  fetchWeekEvents,
  getSplits,
  todayISO,
} from "../services/dataFiles";
import { sendNightlyDigest } from "../services/email";
import {
  addMealLog,
  addWorkoutLog,
  getLatestPlan,
  getMealLogs,
  getProfile,
  getWorkoutLogs,
  saveProfile,
  storageMode,
} from "../services/store";
import { analyzeMealPhoto } from "../services/vision";
import { API_KEYS } from "../config/env";
import { MODELS } from "../llm/models";

export const api = Router();

const fail = (res: Response, e: unknown, code = 500) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[api]", msg);
  res.status(code).json({ error: msg });
};

api.get("/health", (_req, res) => {
  res.json({
    ok: true,
    storage: storageMode,
    models: MODELS,
    geminiKeys: API_KEYS.length,
    today: todayISO(),
    calendar: calendarStatus,
  });
});

// Live probe: actually hits CALENDAR_URL and reports what happened.
// Use this to debug "the agent isn't reading my gist" on the deployed instance.
api.get("/calendar/status", async (_req, res) => {
  try {
    const { events, source } = await fetchWeekEvents(todayISO());
    res.json({
      ok: !calendarStatus.lastError,
      configuredUrl: calendarStatus.configuredUrl,
      normalizedUrl: calendarStatus.normalizedUrl,
      usedSource: source,
      error: calendarStatus.lastError,
      eventsThisWeek: events.length,
    });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Chat with the orchestrator (multi-agent, tool calling, memory) ----------
api.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body ?? {};
    if (!message) return fail(res, "message is required", 400);
    const out = await chatWithOrchestrator(String(sessionId || "default"), String(message));
    res.json(out);
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Weekly plan ----------
api.post("/plan/week", async (req, res) => {
  try {
    const out = await generateWeeklyPlan(req.body?.weekStart);
    res.json(out);
  } catch (e) {
    fail(res, e);
  }
});

api.get("/plan/current", async (_req, res) => {
  try {
    res.json({ plan: await getLatestPlan() });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Schedule (calendar API + workload analysis) ----------
api.get("/schedule", async (req, res) => {
  try {
    const weekStart = String(req.query.weekStart || todayISO());
    const { events, owner, source } = await fetchWeekEvents(weekStart);
    res.json({ owner, source, weekStart, days: analyzeWeek(weekStart, events) });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Splits DB (for the logger UI) ----------
api.get("/splits", (_req, res) => res.json({ splits: getSplits() }));

// ---------- Profile ----------
api.get("/profile", async (_req, res) => {
  try {
    res.json({ profile: await getProfile() });
  } catch (e) {
    fail(res, e);
  }
});
api.post("/profile", async (req, res) => {
  try {
    await saveProfile(req.body);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Workout logs ----------
api.post("/logs/workout", async (req, res) => {
  try {
    const { date, exercise, sets } = req.body ?? {};
    if (!exercise || !Array.isArray(sets) || sets.length === 0)
      return fail(res, "exercise and non-empty sets[] required", 400);
    await addWorkoutLog({ date: date || todayISO(), exercise, sets, note: req.body?.note });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
api.get("/logs/workout", async (req, res) => {
  try {
    res.json({ logs: await getWorkoutLogs(req.query.since as string | undefined) });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Meals: photo analysis + logs ----------
api.post("/meal/analyze", async (req, res) => {
  try {
    const { imageBase64, hint } = req.body ?? {};
    if (!imageBase64) return fail(res, "imageBase64 is required", 400);
    const estimate = await analyzeMealPhoto(String(imageBase64), hint);
    res.json({ estimate, disclaimer: "Rough visual estimate — real calories can vary ±30%." });
  } catch (e) {
    fail(res, e);
  }
});
api.post("/meal/log", async (req, res) => {
  try {
    const { name, kcal } = req.body ?? {};
    if (!name || typeof kcal !== "number") return fail(res, "name and kcal required", 400);
    await addMealLog({
      date: req.body.date || todayISO(),
      name,
      kcal,
      protein: req.body.protein,
      carbs: req.body.carbs,
      fat: req.body.fat,
      items: req.body.items,
      source: req.body.source === "photo" ? "photo" : "manual",
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
api.get("/logs/meals", async (req, res) => {
  try {
    res.json({ logs: await getMealLogs(req.query.since as string | undefined) });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Progress review (ProgressTracker agent) ----------
api.post("/progress/review", async (_req, res) => {
  try {
    const trace: TraceStep[] = [];
    const reply = await runAgent(
      progressAgent,
      "Review my last 14 days of workouts and meals against my goal and current plan. Give concrete suggestions.",
      [],
      trace
    );
    res.json({ reply, trace });
  } catch (e) {
    fail(res, e);
  }
});

// ---------- Nightly digest (called by cron-job.org at 22:00 Asia/Dhaka) ----------
const digestHandler = async (req: Request, res: Response) => {
  try {
    const secret = req.query.secret || req.headers["x-cron-secret"];
    if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET)
      return fail(res, "invalid cron secret", 401);
    res.json(await sendNightlyDigest());
  } catch (e) {
    fail(res, e);
  }
};
api.post("/jobs/nightly-digest", digestHandler);
api.get("/jobs/nightly-digest", digestHandler);
