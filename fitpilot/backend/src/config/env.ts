import dotenv from "dotenv";
dotenv.config();

/**
 * Gemini API key pool.
 * Keys are used round-robin as a FAILOVER mechanism: when a call fails with a
 * 429 / quota error, we rotate to the next key and retry. This keeps the demo
 * alive if one free-tier key is exhausted.
 */
const rawKeys = process.env.GOOGLE_API_KEYS || process.env.GOOGLE_API_KEY || "";
export const API_KEYS: string[] = rawKeys
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

let cursor = 0;

export function currentKey(): string {
  if (API_KEYS.length === 0) {
    throw new Error(
      "No Gemini key configured. Set GOOGLE_API_KEYS in backend/.env (comma-separated for failover)."
    );
  }
  return API_KEYS[cursor % API_KEYS.length];
}

export function rotateKey(): void {
  if (API_KEYS.length > 0) cursor = (cursor + 1) % API_KEYS.length;
}

export const ENV = {
  PORT: Number(process.env.PORT || 8787),
  MODEL_SMART: process.env.GEMINI_MODEL_SMART || "gemini-3-flash",
  MODEL_FAST: process.env.GEMINI_MODEL_FAST || "gemini-3.1-flash-lite",
  MODEL_VISION: process.env.GEMINI_MODEL_VISION || "gemini-3.5-flash",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY:
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",
  CALENDAR_URL: process.env.CALENDAR_URL || "",
  CRON_SECRET: process.env.CRON_SECRET || "change-me",
  // Preferred: Resend (HTTP API, works on Render's free tier). Get a key at resend.com.
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_FROM: process.env.RESEND_FROM || "FitPilot <onboarding@resend.dev>",
  // Fallback: direct Gmail SMTP. Works locally / on paid hosting; Render's FREE tier blocks
  // outbound SMTP ports (25/465/587) as of Sept 2025, so this path will hang there.
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  EMAIL_TO: process.env.EMAIL_TO || "",
  TIMEZONE: process.env.TIMEZONE || "Asia/Dhaka",
};
