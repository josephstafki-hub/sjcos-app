// SJC OS — interactive tools: question boxes for the panel chat.
//
// `ask_owner` is the AskUserQuestion of SJC OS: any agent (Claude runner,
// Hermes gateway, claude.ai over HTTP) calls it mid-run to put a real question
// box in front of Joe — options, headers, multi-select — rendered inline in
// the panel chat. The call BLOCKS: it inserts an agent_interactions row and
// polls until Joe answers (the panel's 2s run poll surfaces it; answering
// flips the row). Timeouts return a clear "no answer" so the agent can carry
// on sensibly instead of hanging forever.
//
// Tagging: the detached Claude runner exports SJC_RUN_ID / SJC_CONVERSATION_ID
// so the row lands on the right chat thread. Callers that can't know them
// (Hermes' gateway-spawned MCP process) insert untagged rows — the panel shows
// any recent untagged pending ask too (single-owner app).

import { z } from "zod";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POLL_MS = 2000;
// Defaults sit under the Hermes gateway's 480s turn timeout. The Claude CLI
// runner exports SJC_ASK_DEFAULT_TIMEOUT_S / SJC_ASK_MAX_TIMEOUT_S (≈24 h,
// under its raised MCP_TOOL_TIMEOUT) so a run through the CLI wrapper can
// wait on Joe with no practical limit.
const DEFAULT_TIMEOUT_S = Number(process.env.SJC_ASK_DEFAULT_TIMEOUT_S ?? 420);
const MAX_TIMEOUT_S = Number(process.env.SJC_ASK_MAX_TIMEOUT_S ?? 540);

const questionSchema = z.object({
  question: z.string().min(1).describe("The complete question. End with a question mark."),
  header: z.string().max(24).optional().describe('Short chip over the question ("Approach", "Send?").'),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(80).describe("The choice as Joe will see and click it."),
        description: z.string().max(300).optional().describe("What picking this means / trade-offs."),
      }),
    )
    .min(2)
    .max(6)
    .describe("2–6 distinct choices. Don't add an 'Other' option — a free-text field is offered automatically."),
  multi_select: z.boolean().optional().describe("Let Joe pick several options (default: one)."),
  allow_other: z.boolean().optional().describe("Offer a free-text 'Other…' answer too (default true)."),
});

/** Format Joe's answer rows back into plain text for the asking model. */
function formatAnswers(response) {
  const answers = Array.isArray(response?.answers) ? response.answers : [];
  if (!answers.length) return "Joe answered, but the answer was empty.";
  return answers
    .map((a) => {
      const picks = Array.isArray(a.choices) && a.choices.length ? a.choices.join(" + ") : "(no option picked)";
      const other = a.other ? ` — Joe added: "${a.other}"` : "";
      return `${a.question}\nJoe's answer: ${picks}${other}`;
    })
    .join("\n\n");
}

/**
 * Register `ask_owner` on an MCP server. `pool` is a pg.Pool; `json` the
 * standard text-content wrapper. Used by mcp/sjcos-mcp.mjs (so Hermes and the
 * remote connectors get it) and mcp/interact-mcp.mjs (the Claude runner's
 * interact server).
 */
export function registerAskOwner(server, { pool, json }) {
  server.registerTool(
    "ask_owner",
    {
      title: "Ask Joe a question (interactive)",
      description:
        "Put a question box in front of Joe INSIDE the chat panel and wait for his answer. " +
        "Use when you are genuinely blocked on a decision that is Joe's to make (which option, " +
        "which client, send or hold) — not for facts you can look up. Provide 1–4 questions, " +
        "each with 2–6 concrete options; Joe can also type a free-text answer. This call BLOCKS " +
        "until Joe answers (or times out) — ask everything you need in one call. Returns his " +
        "choices as text. If it times out, proceed with your best judgment and say what you assumed.",
      inputSchema: {
        questions: z.array(questionSchema).min(1).max(4).describe("The question box(es) to show."),
        timeout_seconds: z
          .number()
          .int()
          .min(30)
          .max(MAX_TIMEOUT_S)
          .optional()
          .describe(`How long to wait for Joe (default ${DEFAULT_TIMEOUT_S}s).`),
      },
    },
    async ({ questions, timeout_seconds }) => {
      const payload = {
        questions: questions.map((q) => ({
          question: q.question,
          header: q.header,
          options: q.options,
          multiSelect: q.multi_select ?? false,
          allowOther: q.allow_other ?? true,
        })),
      };
      const runId = process.env.SJC_RUN_ID || null;
      const conversationId = process.env.SJC_CONVERSATION_ID || null;
      const agent = process.env.SJC_AGENT || process.env.SJCOS_AGENT_NAME || "agent";
      const { rows } = await pool.query(
        `INSERT INTO agent_interactions (run_id, conversation_id, agent, kind, payload)
         VALUES ($1, $2, $3, 'question', $4::jsonb) RETURNING id`,
        [runId, conversationId, agent, JSON.stringify(payload)],
      );
      const id = rows[0].id;

      const deadline = Date.now() + (timeout_seconds ?? DEFAULT_TIMEOUT_S) * 1000;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const r = await pool.query(
          `SELECT status, response FROM agent_interactions WHERE id = $1`,
          [id],
        );
        const row = r.rows[0];
        if (!row) break;
        if (row.status === "answered") return json({ ok: true, answer: formatAnswers(row.response) });
        if (row.status === "dismissed") {
          return json({
            ok: false,
            answer:
              "Joe dismissed the question without answering. Proceed with your best judgment " +
              "and clearly state what you assumed.",
          });
        }
        if (row.status === "expired") break;
      }
      await pool
        .query(`UPDATE agent_interactions SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [id])
        .catch(() => {});
      return json({
        ok: false,
        answer:
          "Joe didn't answer in time. Proceed with your best judgment, clearly state what you " +
          "assumed, and do NOT take any client-facing/irreversible action you were unsure about.",
      });
    },
  );
}
