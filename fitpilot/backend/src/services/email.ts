import nodemailer from "nodemailer";
import { ENV } from "../config/env";
import { addDays, todayISO } from "./dataFiles";
import { getLatestPlan, getProfile } from "./store";

/**
 * The 10pm digest. An external scheduler (cron-job.org, free) calls
 * POST /api/jobs/nightly-digest?secret=... every night at 22:00 Asia/Dhaka;
 * this composes tomorrow's workout + meal plan and emails it.
 * If SMTP is not configured we still return the HTML so the demo can show it.
 */

export async function buildDigest(): Promise<{ subject: string; html: string; date: string } | null> {
  const plan = await getLatestPlan();
  const profile = await getProfile();
  const tomorrow = addDays(todayISO(), 1);
  const day: any = plan?.days?.[tomorrow];
  if (!plan || !day) return null;

  const isWorkout = day.type === "workout";
  const exercisesHtml = isWorkout
    ? `<table cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr style="text-align:left;border-bottom:2px solid #16233B"><th>Exercise</th><th>Sets × Reps</th><th>Guide</th></tr>
        ${day.exercises
          .map(
            (e: any) =>
              `<tr style="border-bottom:1px solid #ddd"><td>${e.name}</td><td>${e.sets} × ${e.reps}${
                e.rpe ? ` @ ${e.rpe}` : ""
              }</td><td>${e.url ? `<a href="${e.url}">video</a>` : "-"}</td></tr>`
          )
          .join("")}
      </table>`
    : `<p>Rest day — recovery is where the muscle is built. Take a walk, stretch, sleep well.</p>`;

  const mealsHtml = (day.nutrition?.meals ?? [])
    .map(
      (m: any) =>
        `<li><b>${m.time} — ${m.name}</b> (~${m.kcal} kcal): ${(m.items ?? []).join(", ")}</li>`
    )
    .join("");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;color:#16233B">
    <h2 style="border-bottom:3px solid #2B5CE6;padding-bottom:8px">FitPilot — your plan for ${tomorrow} (${day.weekday})</h2>
    <p>Hi ${profile.name.split(" ")[0]}, here is tomorrow at a glance. Day busyness: <b>${day.workloadScore}/10</b>.</p>
    <h3>${isWorkout ? `🏋️ ${day.dayName}${day.slot ? ` — suggested slot ${day.slot}` : ""}` : "😴 Rest day"}</h3>
    ${exercisesHtml}
    <h3>🍽 Nutrition (~${day.nutrition?.calories} kcal · ${day.nutrition?.protein}g protein · ${day.nutrition?.waterL}L water)</h3>
    <ul>${mealsHtml || "<li>No meal plan for this day yet.</li>"}</ul>
    ${day.nutrition?.tip ? `<p><i>Tip: ${day.nutrition.tip}</i></p>` : ""}
    <p style="color:#888;font-size:12px">Sent automatically by your FitPilot agent team. Plan: ${plan.splitName}.</p>
  </div>`;

  return { subject: `FitPilot: your ${isWorkout ? day.dayName : "rest day"} plan for ${tomorrow}`, html, date: tomorrow };
}

export async function sendNightlyDigest(): Promise<{
  sent: boolean;
  via?: "resend" | "smtp";
  reason?: string;
  preview?: string;
  date?: string;
}> {
  const digest = await buildDigest();
  if (!digest) return { sent: false, reason: "No plan covers tomorrow — generate a weekly plan first." };

  // ---- Preferred: Resend (HTTP API over port 443, works on Render's free tier) ----
  if (ENV.RESEND_API_KEY && ENV.EMAIL_TO) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: ENV.RESEND_FROM,
          to: [ENV.EMAIL_TO],
          subject: digest.subject,
          html: digest.html,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      return { sent: true, via: "resend", preview: digest.html, date: digest.date };
    } catch (e: any) {
      return { sent: false, reason: `Resend send failed: ${e.message}`, preview: digest.html, date: digest.date };
    }
  }

  // ---- Fallback: direct Gmail SMTP. Fine locally or on a paid Render instance; on Render's
  // free tier this will fail fast (8s) instead of hanging, because outbound SMTP is blocked. ----
  if (ENV.SMTP_USER && ENV.SMTP_PASS && ENV.EMAIL_TO) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
    try {
      await transporter.sendMail({
        from: `FitPilot <${ENV.SMTP_USER}>`,
        to: ENV.EMAIL_TO,
        subject: digest.subject,
        html: digest.html,
      });
      return { sent: true, via: "smtp", preview: digest.html, date: digest.date };
    } catch (e: any) {
      return {
        sent: false,
        reason: `SMTP send failed: ${e.message} (Render's free tier blocks outbound SMTP — set RESEND_API_KEY instead).`,
        preview: digest.html,
        date: digest.date,
      };
    }
  }

  return {
    sent: false,
    reason: "No email method configured. Set RESEND_API_KEY (recommended) or SMTP_USER/SMTP_PASS.",
    preview: digest.html,
    date: digest.date,
  };
}
