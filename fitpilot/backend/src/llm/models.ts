import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { API_KEYS, currentKey, rotateKey, ENV } from "../config/env";

/**
 * Multi-model setup (all on Gemini free tier):
 *  - smart  : orchestrator + planners (stronger reasoning)
 *  - fast   : lightweight analysis agents (cheaper, quicker)
 *  - vision : meal-photo calorie estimation (multimodal)
 */
export type Tier = "smart" | "fast" | "vision";

export const MODELS: Record<Tier, string> = {
  smart: ENV.MODEL_SMART,
  fast: ENV.MODEL_FAST,
  vision: ENV.MODEL_VISION,
};

export function makeModel(tier: Tier, temperature = 0.2): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: MODELS[tier],
    apiKey: currentKey(),
    temperature,
    maxRetries: 0, // retries handled by withKeyRotation
  });
}

const RATE_LIMIT_RE = /429|quota|rate.?limit|RESOURCE_EXHAUSTED|exhausted|overloaded|503/i;

/**
 * Runs an LLM call; on rate-limit/quota errors rotates to the next API key
 * and retries (fn must construct its model inside so the new key applies).
 */
export async function withKeyRotation<T>(fn: () => Promise<T>): Promise<T> {
  const attempts = Math.max(API_KEYS.length, 1) + 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (RATE_LIMIT_RE.test(msg)) {
        lastErr = e;
        rotateKey();
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All Gemini keys are rate-limited right now. Try again in a minute.");
}
