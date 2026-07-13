import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { makeModel, withKeyRotation } from "../llm/models";
import { contentToString, extractJson } from "../agents/runner";

export interface MealEstimate {
  mealName: string;
  items: { name: string; portion: string; kcal: number }[];
  totalKcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: "low" | "medium" | "high";
  notes: string;
}

/**
 * Meal photo -> rough calorie estimate using the vision-tier Gemini model.
 * Estimates are approximate by nature; the UI labels them as such.
 */
export async function analyzeMealPhoto(
  imageDataUrl: string,
  hint?: string
): Promise<MealEstimate> {
  const dataUrl = imageDataUrl.startsWith("data:")
    ? imageDataUrl
    : `data:image/jpeg;base64,${imageDataUrl}`;

  const res = await withKeyRotation(async () =>
    makeModel("vision", 0.1).invoke([
      new SystemMessage(
        `You are a nutrition vision analyst. Identify the food in the photo and estimate portions and calories.
Consider common Bangladeshi/South Asian dishes (bhaat, dal, bhuna, biryani, paratha, etc.) as well as international food.
Return ONLY JSON: {"mealName":string,"items":[{"name":string,"portion":string,"kcal":number}],"totalKcal":number,"protein":number,"carbs":number,"fat":number,"confidence":"low"|"medium"|"high","notes":string}
Round to whole numbers. Be honest with "confidence". If the image is not food, set totalKcal 0 and explain in notes.`
      ),
      new HumanMessage({
        content: [
          {
            type: "text",
            text: hint
              ? `Estimate the calories in this meal. User hint: ${hint}`
              : "Estimate the calories in this meal.",
          },
          { type: "image_url", image_url: dataUrl },
        ],
      }),
    ])
  );
  return extractJson<MealEstimate>(contentToString(res.content));
}
