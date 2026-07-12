# FitPilot — a multi-agent AI fitness coach

Course project (K402 — LLM & Agentic AI Management). A supervisor + 4 specialist LangChain agents
read a weekly calendar, pick a workout split from a real program database, plan meals around
deterministic nutrition math, track progress, and email tomorrow's routine every night at 10pm.

```
                        ┌────────────────────────────────────────────┐
        React (Netlify) │  Express + LangChain (TypeScript, Render)  │
   Dashboard · Coach ───┤                                            │
   Log · Meal scan      │   ORCHESTRATOR  (gemini-2.5-flash)         │
   Progress · Settings  │   "agents as tools" — delegates to:        │
                        │                                            │
                        │   ├─ ScheduleAnalyst (flash-lite)          │
                        │   │    tool: get_weekly_schedule ──► calendar JSON (Gist URL / bundled)
                        │   ├─ WorkoutPlanner  (flash)               │
                        │   │    tools: list_workout_splits,         │
                        │   │           get_split_details ─────► splits DB (from programs.js)
                        │   ├─ NutritionCoach  (flash)               │
                        │   │    tool: calculate_nutrition_targets ► Mifflin-St Jeor (pure code)
                        │   └─ ProgressTracker (flash-lite)          │
                        │        tool: get_progress_data ──────► workout + meal logs
                        │                                            │
                        │   vision tier (flash): meal photo → kcal   │
                        │   storage: Supabase ▸ falls back to local JSON
                        │   nightly digest: cron-job.org → /api/jobs/nightly-digest → Gmail
                        └────────────────────────────────────────────┘
```

## How it maps to the course requirements

| Requirement | Where |
|---|---|
| Node.js + Express backend | `backend/src/index.ts` (entry point per FAQ) |
| Agent logic in LangChain (TS) | `backend/src/agents/*` — `ChatGoogleGenerativeAI` + `tool()` + `bindTools`, explicit ReAct loop in `runner.ts` |
| Multi-model | 3 Gemini tiers: smart (`gemini-2.5-flash`), fast (`gemini-2.5-flash-lite`), vision (`gemini-2.5-flash`) — `llm/models.ts` |
| Tool calling | 7 tools in `agents/tools.ts`; every agent has ≥1 tool |
| Memory | Short-term: per-session chat history (`services/memory.ts`). Long-term: profile, plans, logs persisted (`services/store.ts`) |
| Frontend | React + Vite (`frontend/`), deployed on Netlify |
| Public demo URL | Backend on Render, frontend on Netlify (steps below) |
| Error handling & logs | Key failover rotation, JSON-retry, tool errors surfaced as `TOOL_ERROR`, storage fallback, every step traced |

## The four mandatory test cases (run these live)

1. **Question needing no tool** — Coach tab: *"What is RPE?"* → orchestrator answers directly;
   trace shows zero tool calls.
2. **Question needing a tool** — *"How busy is my week? When can I train?"* → trace shows
   delegation to ScheduleAnalyst → `get_weekly_schedule` fetching the calendar API.
3. **Ambiguous request** — *"Make it harder."* → orchestrator asks one clarifying question
   (harder workouts? stricter diet?) instead of guessing.
4. **Failure scenario** — stop the backend and send a chat message → UI shows a clean error
   banner. Or set an invalid Gemini key first in `GOOGLE_API_KEYS` → the failover rotates to the
   next key and the request still succeeds (watch backend logs).

## Run it locally (5 minutes)

```bash
# 1. Backend
cd backend
cp .env.example .env          # paste at least one Gemini key into GOOGLE_API_KEYS
npm install
npm run dev                   # http://localhost:8787  → check /api/health

# 2. Frontend (new terminal)
cd frontend
cp .env.example .env          # VITE_API_URL=http://localhost:8787 is the default
npm install
npm run dev                   # http://localhost:5173
```

Get Gemini keys free at **https://aistudio.google.com/apikey**. Multiple keys, comma-separated,
act as a failover pool: when one key returns 429/quota, the backend rotates to the next and
retries. (Note: Google's terms prohibit circumventing rate limits — treat the pool as resilience
for the demo, not a quota multiplier.)

With zero other configuration the app is fully functional: the calendar comes from
`backend/data/calendar.json` and storage is a local JSON file.

## Deploy for the demo

**Backend → Render (free):**
1. Push this repo to GitHub. In Render: New → Web Service → your repo.
2. Root directory `backend`, build `npm install && npm run build`, start `npm start`.
3. Add env vars from your `.env` (at minimum `GOOGLE_API_KEYS`).
4. Note the URL, e.g. `https://fitpilot-api.onrender.com` — test `/api/health`.
5. Free Render instances sleep after idle; open the health URL a few minutes before presenting.

**Frontend → Netlify (free):**
1. New site from Git → same repo → base directory `frontend` (netlify.toml does the rest).
2. Env var `VITE_API_URL=https://<your-render-url>` (no trailing slash). Deploy.

**Calendar as a real API call (recommended for the demo):**
Upload `backend/data/calendar.json` to a GitHub Gist, click *Raw*, and set that URL as
`CALENDAR_URL` on Render. The ScheduleAnalyst's tool now does a genuine HTTP fetch — and you can
edit the Gist mid-demo ("my Thursday just got busy"), regenerate, and watch the plan change.

**Supabase (optional, durable storage):** create a free project → SQL editor → run
`supabase/schema.sql` → set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service_role, server-side
only) on Render. Without it, local-JSON storage works but resets when Render restarts.

**Nightly 10pm email:**
1. Gmail → enable 2-step verification → create an App Password (myaccount.google.com/apppasswords).
2. Set `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO`, `CRON_SECRET` on Render.
3. cron-job.org (free): new job → URL
   `https://<render-url>/api/jobs/nightly-digest?secret=<CRON_SECRET>` → schedule daily 22:00,
   timezone Asia/Dhaka.
4. Demo trick: hit that URL in a browser any time — it returns the HTML preview (and `sent:true`
   if SMTP is configured), so you never have to wait for 10pm on stage.

## Design decisions to explain in Q&A

- **Supervisor-worker, "agents as tools":** the orchestrator is itself a tool-calling agent whose
  tools ARE the four specialists. Delegation shows up in the trace as a tool call — one uniform,
  explainable mechanism (`agents/orchestrator.ts`).
- **One ReAct loop for everything** (`agents/runner.ts`): model reasons → requests tools → we
  execute → append observations → repeat. ~60 lines, every step traced with timing. Easy to
  defend line by line.
- **LLM chooses, code computes:** calorie/macro/water math is deterministic (Mifflin-St Jeor in
  `services/nutrition.ts`); workload scores and free windows are computed, not guessed
  (`services/dataFiles.ts`); the final plan's exercises and video URLs are attached by server code
  from the splits DB. The model can't hallucinate a number or a YouTube link into the plan.
- **Token discipline for free tier:** agents see split *metadata* first and fetch details for one
  split only; schedules are compacted before prompting.
- **Fail-safe chain:** key pool rotation on 429 → calendar URL falls back to the bundled file →
  Supabase falls back to local JSON → JSON parsing retries once → tool errors return as strings
  the agent can react to. A single dead dependency never kills the demo.
- **Memory:** conversational (last 12 turns per session) + persistent (profile, plans, logs) —
  the orchestrator's system prompt is rebuilt each turn from persistent state.

## API quick reference

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
| `POST /api/progress/review` | ProgressTracker agent review |
| `GET/POST /api/jobs/nightly-digest?secret=` | build + send tomorrow's email |

## Known limitations (say them before they're asked)

- Single demo user, no auth — out of scope for the assignment.
- Calorie photo estimates are ±30% by nature; the UI labels them as rough.
- Browser notification fires only while the tab is open (the email digest covers the real case).
- Free Render sleeps on idle (first request after sleep takes ~30s) and local-JSON storage there
  is ephemeral — use Supabase for persistence across restarts.
- Health guidance is general fitness advice, not medical advice.
