// SJC OS — MCP read tools for SMS threads and phone calls.
//
// READ ONLY. Texting and dialing live in mcp/grants-tools.mjs as send_sms /
// place_call, each requiring an owner grant. These tools let an agent read
// a conversation before it asks Joe for permission to reply, and read a
// call's transcript + AI notes to act on them (file work items, draft
// follow-ups for approval). Phone numbers are business contact data and are
// returned; recordings are not (a file id is, for the owner's UI).

import { z } from "zod";

export function registerCommsTools(server, { rows, json }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

  server.registerTool(
    "list_sms_threads",
    {
      title: "List text-message threads",
      description:
        "Recent SMS conversations on the business number: counterparty, linked record (lead / project / " +
        "sub / vendor), unread (inbound awaiting a reply), and opted_out (they texted STOP — do not draft " +
        "to them). Newest first.",
      inputSchema: {
        unread_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ unread_only, limit }) => {
      try {
        const r = await rows(
          `SELECT id, phone, contact_name, link_type, link_slug, unread, opted_out,
                  last_message_at, last_inbound_at, last_outbound_at
             FROM sms_threads
            WHERE ($1::boolean IS NOT TRUE OR unread = true)
            ORDER BY last_message_at DESC NULLS LAST, id DESC
            LIMIT $2`,
          [Boolean(unread_only), limit ?? 50],
        );
        return json(r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_sms_thread",
    {
      title: "Read a text-message thread",
      description:
        "One SMS conversation with its messages (direction in/out, status, delivery errors, MMS " +
        "attachment file ids). Read this before asking for permission to reply.",
      inputSchema: { thread_id: z.number().int().positive(), limit: z.number().int().min(1).max(500).optional() },
    },
    async ({ thread_id, limit }) => {
      try {
        const t = await rows(
          `SELECT id, phone, contact_name, link_type, link_slug, unread, opted_out, opted_out_at, business_number,
                  last_message_at FROM sms_threads WHERE id = $1`,
          [thread_id],
        );
        if (!t.length) return fail(new Error(`No SMS thread ${thread_id}.`));
        const messages = await rows(
          `SELECT id, direction, body, status, media, error_detail, failure_kind, keyword, sent_by, created_at
             FROM sms_messages WHERE thread_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
          [thread_id, limit ?? 100],
        );
        return json({ thread: t[0], messages: messages.reverse() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_calls",
    {
      title: "List phone calls",
      description:
        "Recent calls on the business number (inbound forwarded to Joe, voicemails, click-to-call): " +
        "who, direction, outcome (answered / voicemail / missed / no_answer / failed), duration, whether a " +
        "transcript and AI notes exist, and the linked record. Newest first.",
      inputSchema: {
        outcome: z.enum(["answered", "voicemail", "missed", "no_answer", "failed"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ outcome, limit }) => {
      try {
        const r = await rows(
          `SELECT id, direction, counterparty_number, contact_name, link_type, link_slug, status, outcome,
                  started_at, ended_at, duration_s, recording_status, transcript_status, notes_status, work_item_id
             FROM calls
            WHERE ($1::text IS NULL OR outcome = $1)
            ORDER BY started_at DESC LIMIT $2`,
          [outcome ?? null, limit ?? 50],
        );
        return json(r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_call",
    {
      title: "Read a call: transcript + AI notes",
      description:
        "One call with its transcript (when Telnyx transcription has landed), the reviewed AI notes " +
        "(summary, decisions, action items, scope/price/schedule flags), the linked record and the " +
        "voicemail callback work item. Use the notes to file work items or draft a follow-up for approval — " +
        "never to change a lead/project stage.",
      inputSchema: { call_id: z.string().uuid() },
    },
    async ({ call_id }) => {
      try {
        const r = await rows(
          `SELECT id, direction, counterparty_number, business_number, contact_name, link_type, link_slug, lead_id, project_id,
                  status, outcome, started_at, answered_at, ended_at, duration_s, hangup_cause,
                  recording_status, recording_file_id, transcript_status, transcript,
                  notes_status, notes, notes_text, notes_error, knowledge_item_id, work_item_id, placed_by, error
             FROM calls WHERE id = $1`,
          [call_id],
        );
        if (!r.length) return fail(new Error(`No call ${call_id}.`));
        const events = await rows(`SELECT event_type, note, occurred_at FROM call_events WHERE call_id = $1 ORDER BY id`, [call_id]);
        return json({ call: r[0], events });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
