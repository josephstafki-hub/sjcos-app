"use server";

import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";

/** Ask the AI to re-rank today's priorities. Returns the given titles in the
 *  model's recommended order. Robust to free-form replies (we extract the item
 *  numbers); degrades to the original order if the model gives nothing usable
 *  (e.g. the mock provider), so the button is always safe to press. */
export async function reprioritizeToday(titles: string[]): Promise<string[]> {
  await requireRole("owner");
  if (titles.length <= 1) return titles;

  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  try {
    const { suggestions } = await ai.suggest({
      kind: "reprioritize",
      context:
        `These are today's tasks for a remodeling business owner. Re-rank ` +
        `them by urgency and impact, most important first. Reply with just ` +
        `the item numbers in the new order, e.g. "3, 1, 2".\n\n${numbered}`,
    });
    const order: number[] = [];
    for (const m of suggestions.join(" ").matchAll(/\d+/g)) {
      const idx = Number(m[0]) - 1;
      if (idx >= 0 && idx < titles.length && !order.includes(idx)) order.push(idx);
    }
    for (let i = 0; i < titles.length; i++) if (!order.includes(i)) order.push(i);
    return order.map((i) => titles[i]);
  } catch {
    return titles;
  }
}
