import cors from "cors";
import express from "express";
import { API_KEYS, ENV } from "./config/env";
import { MODELS } from "./llm/models";
import { api } from "./routes/api";
import { storageMode } from "./services/store";

/**
 * FitPilot backend — Node.js + Express + LangChain (TypeScript).
 * Entry point per course guidelines: src/index.ts
 */
const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" })); // meal photos arrive as base64

app.use("/api", api);
app.get("/", (_req, res) =>
  res.json({ name: "FitPilot API", docs: "/api/health", status: "running" })
);

app.listen(ENV.PORT, () => {
  console.log(`\nFitPilot backend on http://localhost:${ENV.PORT}`);
  console.log(`  storage : ${storageMode}${storageMode === "local-json" ? " (set SUPABASE_URL for Postgres)" : ""}`);
  console.log(`  models  : smart=${MODELS.smart} fast=${MODELS.fast} vision=${MODELS.vision}`);
  console.log(`  gemini  : ${API_KEYS.length} key(s) in failover pool`);
  console.log(`  calendar: ${ENV.CALENDAR_URL || "bundled data/calendar.json"}\n`);
});
