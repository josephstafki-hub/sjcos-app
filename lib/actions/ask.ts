"use server";

import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";

/** Ask Qwen a free-form question from the command bar / Ask-Qwen pill.
 *  `pageContext` (optional) is a structured text brief of the page the user
 *  invoked Qwen from — page-invoked Qwen answers with it; the menu-bar entry
 *  passes none (general assistant). Page-context plumbing lands in a later
 *  session; the param is here so callers can start passing it. */
export async function askQwen(
  prompt: string,
  pageContext?: string,
): Promise<{ ok: boolean; answer?: string; error?: string }> {
  await requireRole("owner");
  const q = prompt.trim();
  if (!q) return { ok: false, error: "Ask a question first." };
  try {
    const { answer } = await ai.ask({ prompt: q, context: pageContext });
    return { ok: true, answer: answer || "I don't have an answer for that yet." };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
