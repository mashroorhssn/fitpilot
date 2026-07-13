# FitPilot — a multi-agent AI fitness coach

> **Live app:** https://fitpilotgo.netlify.app/ · **API:** https://fitpilot-api-5v1o.onrender.com/api/health · **Repo:** https://github.com/mashroorhssn/fitpilot/

**Course:** K402 — LLM & Agentic AI Management · **Instructor:** Dr. Asif Naimur Rashid

**Team:**

| Member | |
|---|---|
| K. M. Mashroor Hossain | GitHub: [@mashroorhssn](https://github.com/mashroorhssn) |
| Naim Uddin Shuvo | |
| Tahsina Jannat Noon | |

---

## Executive summary

FitPilot answers a question every busy student faces: *"I have a good workout program — but my week never looks the same twice, so how do I actually fit it in?"*

The system is a **supervisor–worker team of five LangChain agents** running on Google Gemini's free tier. Each week, the team (1) fetches the user's calendar through an external API call and computes a deterministic per-day workload score, (2) selects the best-fitting workout split from a real program database (Jeff Nippard's Min-Max and Ultimate PPL programs, plus two derived busy-week splits), (3) maps training days onto the calendar's actual free windows, and (4) designs a Dhaka-friendly meal plan around calorie/macro/water targets computed by code, not guessed by the model. Users chat with the orchestrator to adjust anything, log sets and reps, photograph meals for vision-based calorie estimates, and receive a **10 PM nightly email** with tomorrow's full routine.

Two engineering principles drive the design. First, **"the LLM chooses, the code computes"**: every number (macros, workload scores, time windows) and every fact (exercises, video URLs) in the final plan comes from deterministic code or the database — the model only makes judgment calls, so nothing can be hallucinated into a plan. Second, **fail-safe layering**: API-key failover rotation, calendar and storage fallbacks, JSON-parse retries, and timeouts mean no single dead dependency can kill the app. Every agent step is captured in an **execution trace** rendered in the UI, making the entire multi-agent reasoning process inspectable live.

The project is fully deployed (React/Vite on Netlify; Express/LangChain/TypeScript on Render; optional Supabase persistence) and passes all four required test scenarios: no-tool questions, tool-requiring questions, ambiguous requests, and failure handling.

---

## Contents

1. [Architecture](#1-architecture)
2. [Live demo](#2-live-demo)
3. [Q&A preparation](#3-qa-preparation)
4. [Project structure](#4-project-structure)
5. [API reference](#5-api-reference)
6. [Running locally](#6-running-locally)
7. [Full deployment guide](#7-full-deployment-guide-beginner-friendly)
8. [Known limitations](#8-known-limitations)
9. [Acknowledgments](#9-acknowledgments)

---

## 1. Architecture 

### 1.1 System overview

```
                        ┌────────────────────────────────────────────┐
        React (Netlify) │  Express + LangChain (TypeScript, Render)  │
   Dashboard · Coach ───┤                                            │
   Log · Meal scan      │   ORCHESTRATOR  (gemini-2.5-flash)         │
   Progress · Settings  │   "agents as tools" — delegates to:        │
                        │                                            │
                        │   ├─ ScheduleAnalyst (flash-lite)          │
                        │   │    tool: get_weekly_schedule ──► calendar JSON (Gist URL)
                        │   ├─ WorkoutPlanner  (flash)               │
                        │   │    tools: list_workout_splits,         │
                        │   │           get_split_details ─────► splits DB (4 programs)
                        │   ├─ NutritionCoach  (flash)               │
                        │   │    tool: calculate_nutrition_targets ► Mifflin-St Jeor (pure code)
                        │   └─ ProgressTracker (flash-lite)          │
                        │        tool: get_progress_data ──────► workout + meal logs
                        │                                            │
                        │   vision tier (flash): meal photo → kcal   │
                        │   storage: Supabase ▸ falls back to local JSON
                        │   nightly digest: cron-job.org → API → Resend (HTTP email)
                        └────────────────────────────────────────────┘
```

### 1.2 The agent team

| Agent | Model tier | Responsibility | Tools |
|---|---|---|---|
| **Orchestrator** | smart (`gemini-2.5-flash`) | Routes user requests; answers trivial questions directly; asks a clarifying question when the request is ambiguous | the 4 specialists (as tools) + `get_current_plan` |
| **ScheduleAnalyst** | fast (`gemini-2.5-flash-lite`) | Fetches the weekly calendar via API and explains it for training purposes | `get_weekly_schedule` |
| **WorkoutPlanner** | smart | Selects a split *from the database* and maps its training days onto real free windows | `list_workout_splits`, `get_split_details`, `get_weekly_schedule`, `get_user_profile` |
| **NutritionCoach** | smart | Turns computed daily targets into practical, affordable Dhaka-friendly meals | `calculate_nutrition_targets`, `get_user_profile`, `get_current_plan` |
| **ProgressTracker** | fast | Reviews 14 days of logs vs. plan and goal; recommends concrete adjustments | `get_progress_data`, `get_current_plan`, `get_user_profile` |

A separate **vision tier** (`gemini-2.5-flash` multimodal) powers meal-photo calorie estimation.

### 1.3 One explainable agent loop

Every agent — including the orchestrator — runs the **same ~60-line ReAct loop** (`backend/src/agents/runner.ts`), built directly on LangChain primitives (`ChatGoogleGenerativeAI`, `tool()`, `bindTools`):

1. The model reasons over the conversation (bound to its tools).
2. If it requested tool calls → execute them, append the observations, repeat.
3. If it answered in plain text → done.

Each iteration appends a `TraceStep {agent, kind, label, detail, ms}` to a shared trace that the frontend renders as an expandable **"How the agents worked"** panel — the whole reasoning chain is visible during the demo.

### 1.4 Supervisor–worker via "agents as tools"

The orchestrator is itself a tool-calling agent whose tools *are* the four specialists (`backend/src/agents/orchestrator.ts`). Delegation is therefore just another tool call — one uniform mechanism for routing, tool use, and tracing, instead of a bespoke router. Each specialist has a narrow toolset (least privilege) and a single responsibility (domain decomposition).

### 1.5 "The LLM chooses, the code computes"

The single most important design decision:

- **Workload scores & free windows** are computed deterministically from calendar events (`services/dataFiles.ts`) — the model reads them, never invents them.
- **Calories, macros, water** come from Mifflin-St Jeor math in `services/nutrition.ts`, adjusted for training minutes, day busyness, and goal. Agents *must* call the calculator tool; computed values always override model output in the saved plan.
- **Exercises and video URLs** are attached to the final plan by server code from `splits.json` after the planner picks a split and day mapping. The model cannot hallucinate an exercise or a YouTube link into the plan.

### 1.6 Memory

- **Short-term:** per-session conversation history, capped at 12 turns (`services/memory.ts`).
- **Long-term:** profile, weekly plans, workout logs, and meal logs persisted in the store; the orchestrator's system prompt is rebuilt every turn from this persistent state, so the coach always knows the current plan and profile.

### 1.7 Fail-safe layering (error handling)

| Failure | Response |
|---|---|
| Gemini key returns 429 / quota / 503 | Key pool rotates to the next key and retries (`llm/models.ts`) |
| `CALENDAR_URL` unreachable | Falls back to the bundled `data/calendar.json` |
| Supabase not configured / down | Falls back to a local JSON file store |
| Model returns malformed JSON in the planning pipeline | One automatic re-prompt ("return ONLY valid JSON") |
| A tool throws | The error string is returned to the agent as an observation, so it can react and explain |
| SMTP blocked by host (see §3.3) | Email sends via Resend's HTTPS API; the SMTP fallback has an 8 s timeout instead of hanging |

### 1.8 Free-tier token discipline

Agents first see split *metadata* only and fetch full details for one chosen split; calendar analyses are compacted before prompting. This keeps every request well inside free-tier limits and shortens latency.

### 1.9 Course requirement mapping

| Requirement | Where |
|---|---|
| Node.js + Express backend, entry `src/index.ts` | `backend/src/index.ts` |
| Agent logic in LangChain (TypeScript) | `backend/src/agents/*` |
| `tsconfig.json` per course spec | `backend/tsconfig.json` (ES2020, CommonJS, rootDir src, outDir dist, strict, esModuleInterop) |
| Multi-model | 3 Gemini tiers — smart / fast / vision (`llm/models.ts`) |
| Tool calling | 7 tools (`agents/tools.ts`); every agent has ≥ 1 tool |
| Memory | Session history + persistent store (§1.6) |
| Frontend with public URL | React + Vite on Netlify — https://fitpilotgo.netlify.app/ |
| Logs & error handling | Trace system + fail-safe chain (§1.7) |
| Four test scenarios | Scripted in §2.3 |

---

## 2. Live demo

### 2.1 Public URLs

- **Frontend:** https://fitpilotgo.netlify.app/
- **Backend health check:** https://fitpilot-api-5v1o.onrender.com/api/health

> ⚠️ **Free-tier note:** Render puts idle free services to sleep. Open the health-check URL **2–3 minutes before presenting** — the first request after sleep takes ~30 s; everything after that is fast.

### 2.2 Demo flow 

1. **Dashboard → "Generate my week."** The pipeline runs ScheduleAnalyst → WorkoutPlanner → NutritionCoach (20–60 s on the free tier). Point out the **Week Strip**: workload meters per day, rest days landing on the busiest days, session slots placed inside real free windows.
2. **Expand the trace** under the generate button — walk through the steps: calendar fetched (with event count and source), planner's split choice and rationale, nutrition sections.
3. **Coach tab** — run the four test cases below; expand each reply's trace.
4. **Meal scan** — upload a food photo; the vision model returns items, portions, kcal/macros with a confidence label; log it.
5. **Log a workout** (a couple of sets) → **Progress tab** → "Run progress review": the ProgressTracker reads the logs and gives concrete suggestions.
6. **Nightly digest** — open `https://fitpilot-api-5v1o.onrender.com/api/jobs/nightly-digest?secret=<CRON_SECRET>` in a browser tab: it returns the email JSON immediately (no need to wait for 10 PM). Mention cron-job.org fires this daily at 22:00 Asia/Dhaka.

### 2.3 The four required test scenarios

| # | Scenario | Say this in Coach | Expected behaviour |
|---|---|---|---|
| 1 | **Question needing no tool** | *"What is RPE?"* | Orchestrator answers directly; trace shows **zero** tool calls |
| 2 | **Question needing a tool** | *"How busy is my week? When can I train?"* | Trace shows delegation → ScheduleAnalyst → `get_weekly_schedule` API fetch |
| 3 | **Ambiguous request** | *"Make it harder."* | Orchestrator asks **one clarifying question** (harder training? stricter diet?) instead of guessing |
| 4 | **Failure scenario** | Put an invalid key first in `GOOGLE_API_KEYS` on Render, then chat | Backend logs show the failover rotating to the next key; the request still succeeds. (Alternative: stop the backend → the UI shows a clean error banner, no crash) |

---

## 3. Q&A preparation

### 3.1 Decisions we expect to defend

**Why a hand-written ReAct loop instead of a prebuilt executor?**
Explainability was graded above complexity. Our loop is ~60 lines, uses only LangChain core primitives, logs every step with timing, and every team member can walk through it line by line. Prebuilt executors hide exactly the part we're being examined on.

**Why "agents as tools" for orchestration?**
It collapses three mechanisms (routing, tool calling, tracing) into one. A delegation *is* a tool call, so the same runner, the same trace format, and the same error handling cover the whole system.

**Why is the math deterministic instead of letting the LLM compute?**
LLMs are unreliable calculators and confident hallucinators. Nutrition targets, workload scores, and exercise data are facts — code produces them; the model only makes judgment calls (which split, which meal, which day). This also makes outputs reproducible and testable.

**Why multiple Gemini API keys?**
As a **failover pool** for resilience: on a 429/quota error the backend rotates to the next key and retries, which doubles as our failure-scenario handling. (Google's ToS prohibits circumventing rate limits, so the pool is framed and used as failover, not a quota multiplier.)

**Why Gemini free tier at all?**
The assignment constraint was zero budget. The architecture is model-agnostic — swapping tiers is a one-line env change (`GEMINI_MODEL_SMART=`...), and the token-discipline design (§1.8) exists precisely because of free-tier limits.

**How do you stop hallucinated workouts?**
The planner outputs only a split ID and a date→day-name mapping. Server code validates the ID against the database and attaches the real exercises/URLs. An invented split ID fails validation and the request errors loudly rather than saving garbage.

### 3.2 A real production issue we hit and fixed

Our nightly email originally used Gmail SMTP via Nodemailer. It worked locally but **hung forever on Render** — because Render's free tier blocks outbound SMTP ports (25/465/587) since September 2025. Diagnosis: the request wasn't erroring, it was waiting on a TCP connection the host silently drops. Fix: switched to **Resend's HTTPS email API** (port 443 is never blocked), kept SMTP as a local-dev fallback with an 8-second timeout so it fails fast instead of hanging. This is a nice concrete example of environment-dependent failure and graceful-degradation design.

### 3.3 Dependency pinning (if asked why versions are exact)

`zod` is pinned to **3.23.8** and `@langchain/core` to **0.3.42** (with npm `overrides`). Newer zod (3.25+) ships dual v3/v4 type definitions that trigger a TypeScript type-instantiation explosion (`TS2589`) inside LangChain's `tool()` generics — compile memory blows past 3 GB. The pinned pair compiles cleanly and quickly. **Do not bump these two packages.**

---

## 4. Project structure

```
fitpilot/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express entry point
│   │   ├── config/env.ts         # env + Gemini key failover pool
│   │   ├── llm/models.ts         # multi-model tiers + rotation retry
│   │   ├── agents/
│   │   │   ├── runner.ts         # the shared ReAct loop + trace
│   │   │   ├── tools.ts          # all 7 tools (zod schemas)
│   │   │   ├── agents.ts         # 4 specialist configs + prompts
│   │   │   ├── orchestrator.ts   # supervisor ("agents as tools")
│   │   │   └── pipeline.ts       # Generate-my-week pipeline
│   │   ├── services/
│   │   │   ├── dataFiles.ts      # calendar fetch/materialize + workload math
│   │   │   ├── nutrition.ts      # Mifflin-St Jeor (deterministic)
│   │   │   ├── store.ts          # Supabase ▸ local-JSON storage
│   │   │   ├── memory.ts         # per-session chat memory
│   │   │   ├── vision.ts         # meal photo → kcal (multimodal)
│   │   │   └── email.ts          # nightly digest (Resend ▸ SMTP fallback)
│   │   └── routes/api.ts         # all endpoints
│   └── data/
│       ├── splits.json           # 4 workout programs (exercises + video URLs)
│       └── calendar.json         # synthetic weekly calendar template
├── frontend/                     # React + Vite + TS (Netlify)
│   └── src/components/           # Dashboard, Coach, Logger, MealScan, Progress, Settings
└── supabase/schema.sql           # optional persistent storage tables
```

## 5. API reference

| Endpoint | What |
|---|---|
| `GET /api/health` | status, storage mode, models, key count |
| `POST /api/chat` `{message, sessionId}` | orchestrator chat → `{reply, trace}` |
| `POST /api/plan/week` | full pipeline: schedule → split → meals → save |
| `GET /api/plan/current` · `GET /api/schedule` · `GET /api/splits` | data reads |
| `GET/POST /api/profile` | profile |
| `POST /api/logs/workout` · `GET /api/logs/workout` | set/rep logs |
| `POST /api/meal/analyze` `{imageBase64, hint?}` | vision calorie estimate |
| `POST /api/meal/log` · `GET /api/logs/meals` | meal logs |
| `POST /api/progress/review` | ProgressTracker review → `{reply, trace}` |
| `GET/POST /api/jobs/nightly-digest?secret=` | build + send tomorrow's email |

## 6. Running locally

```bash
# Backend
cd backend
cp .env.example .env       # paste ≥1 Gemini key into GOOGLE_API_KEYS
npm install
npm run dev                # http://localhost:8787 → check /api/health

# Frontend (second terminal)
cd frontend
cp .env.example .env       # default VITE_API_URL=http://localhost:8787
npm install
npm run dev                # http://localhost:5173
```

Gemini keys are free at https://aistudio.google.com/apikey. With no other configuration the app is fully functional: the calendar comes from the bundled JSON and storage is a local file.

---

## 7. Full deployment guide (beginner-friendly)

Everything below is free and needs no credit card. Accounts required: **GitHub**, **Render** (sign up with GitHub), **Netlify** (sign up with GitHub), **Google AI Studio**, and — for the nightly email — **Resend** and **cron-job.org**.

### 7.1 Get a Gemini API key

1. Go to https://aistudio.google.com/apikey → **Create API key** → copy it (starts with `AIza...`).
2. Optional: repeat with a second Google account for a failover key; keys are comma-separated later.

### 7.2 Put the project on GitHub

Repo root must contain `backend/` and `frontend/` side by side. Easiest path without a terminal: https://github.com/new → create a public repo → *"uploading an existing file"* → drag the whole project folder in → **Commit changes**.

### 7.3 Deploy the backend on Render

1. https://dashboard.render.com → **New + → Web Service** → select the repo.
2. Settings:

   | Field | Value |
   |---|---|
   | Root Directory | `backend` |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |

3. Environment variable (required): `GOOGLE_API_KEYS` = your key(s), comma-separated.
4. **Create Web Service**, watch the Logs tab (~2–4 min) for the `FitPilot backend on ...` boot line.
5. **Verify:** open `https://<your-service>.onrender.com/api/health` — expect `{"ok":true,...}`.

> Free services sleep after ~15 idle minutes; the next request takes ~30 s to wake them.

### 7.4 Deploy the frontend on Netlify

1. https://app.netlify.com → **Add new site → Import an existing project** → same repo.
2. Settings (the bundled `netlify.toml` prefills most of this):

   | Field | Value |
   |---|---|
   | Base directory | `frontend` |
   | Build command | `npm run build` |
   | Publish directory | `frontend/dist` |

3. Environment variable: `VITE_API_URL` = your Render URL, **no trailing slash**.
4. **Deploy site** → open the generated URL → click **Generate my week** to verify end-to-end.
5. Optional: *Site settings → Change site name* for a friendlier URL.

### 7.5 Calendar as a real external API (recommended)

1. https://gist.github.com → paste the contents of `backend/data/calendar.json` → name it `calendar.json` → **Create public gist**.
2. Click **Raw**, copy that URL.
3. On Render add `CALENDAR_URL` = that URL. Now the ScheduleAnalyst's tool does a genuine HTTP fetch — and you can edit the Gist mid-demo, regenerate, and watch the plan adapt.

### 7.6 Supabase (optional — durable storage)

Without it, data lives in a JSON file that resets when the free Render service restarts.

1. https://supabase.com → New project.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Project Settings → API** → copy the Project URL and the **`service_role`** key.
4. On Render add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Boot logs should now say `storage: supabase`.

### 7.7 Nightly 10 PM email (Resend + cron-job.org)

> **Why not Gmail SMTP?** Render's free tier blocks outbound SMTP ports (25/465/587), so Nodemailer hangs there. Resend sends over HTTPS (port 443), which always works. Gmail SMTP still works for local runs.

1. https://resend.com → sign up → **API Keys** → create a key (`re_...`).
2. On Render add:

   | Key | Value |
   |---|---|
   | `RESEND_API_KEY` | your `re_...` key |
   | `EMAIL_TO` | **the same email you signed up to Resend with** (see note) |
   | `CRON_SECRET` | any random string you invent |

   Leave `RESEND_FROM` at its default (`FitPilot <onboarding@resend.dev>`).
   *Note:* with the default sender and no verified domain, Resend delivers **only to your own Resend signup address** — exactly the self-digest use case. Verify a domain in Resend only if you ever need to email someone else.
3. **Test immediately** (no need to wait for 10 PM): open
   `https://<render-url>/api/jobs/nightly-digest?secret=<CRON_SECRET>` in a browser — expect `{"sent":true,"via":"resend",...}` and the email in your inbox. (If no plan covers tomorrow, generate a week first.)
4. https://cron-job.org → free account → **Create cronjob**: URL = the link above, schedule **daily 22:00**, timezone **Asia/Dhaka**.

### 7.8 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Frontend: "Can't reach the FitPilot backend" | Wrong/missing `VITE_API_URL`, or backend asleep | Fix the Netlify env var and redeploy; open `/api/health` to wake the backend |
| Render build fails | Root Directory isn't `backend`, or command typo | Recheck §7.3 values in Render → Settings |
| "Generate my week" errors | Bad/missing Gemini key or quota | Check `GOOGLE_API_KEYS` on Render; add a fresh key |
| Digest URL hangs (paid host w/ SMTP) or `sent:false` | Email env vars missing | Set `RESEND_API_KEY` + `EMAIL_TO` (§7.7); read the returned `reason` field |
| Works locally, not deployed | `.env` values were never entered in Render/Netlify dashboards | Re-enter each variable there — `.env` files are not uploaded |
| TypeScript build explodes in memory | `zod`/`@langchain/core` were upgraded | Restore the exact pinned versions (§3.3) |

Changing any env var: Render → service → **Environment** → save (auto-redeploys). Netlify → **Site settings → Environment variables** → save → **Deploys → Trigger deploy**.

---

## 8. Known limitations

- **Single demo user, no authentication** — out of scope for the assignment; the storage layer is structured so a user-ID column is a small addition.
- **Photo calorie estimates are ±30% by nature** — the UI labels them as rough estimates with a confidence level.
- **Browser notifications fire only while the tab is open** — the email digest covers the real use case.
- **Free Render sleeps on idle** (first request ~30 s) and its local-JSON storage is ephemeral — Supabase (§7.6) makes data durable.
- **Free-tier latency** — plan generation takes 20–60 s; the UI shows pipeline progress messaging.
- **General fitness guidance only** — the coach explicitly defers medical questions to professionals.

## 9. Acknowledgments

- Workout program structure and exercise data adapted from **Jeff Nippard's Min-Max (Block 1) and Ultimate PPL (Phase 1)** program spreadsheets, used here for educational purposes; exercise technique video links point to their original public sources.
- Built with **LangChain.js**, **Google Gemini**, **Express**, **React/Vite**, **Supabase**, **Resend**, **Render**, and **Netlify** — all on free tiers.
