import { z } from "zod";
import { getCurrentUser } from "@/lib/dal";
import { commsRead, CommsReadError } from "@/lib/mobile-rpc/comms-reads";
import { sendNewEmailAction, sendReplyAction } from "@/lib/actions/inbox";

const schema = z.object({
  mode: z.enum(["new", "reply", "replyAll"]),
  threadId: z.string().regex(/^[-\w]+$/).max(512).optional(),
  view: z.string().max(600).optional(),
  to: z.string().max(20000), cc: z.string().max(2000).optional(),
  subject: z.string().max(2000), body: z.string().trim().min(1).max(20000),
}).superRefine((value, ctx) => {
  if (value.mode !== "new" && !value.threadId) ctx.addIssue({ code: "custom", message: "Thread is required for replies." });
  if (value.mode === "new" && !value.to.trim()) ctx.addIssue({ code: "custom", message: "Recipient is required." });
});

export async function POST(req: Request) {
  return commsRead(req, "inbox", async user => {
    if ((await getCurrentUser())?.id !== user.id) throw new CommsReadError("Unauthorized", 401);
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) throw new CommsReadError("Expected multipart/form-data.");
    let form: FormData;
    try { form = await req.formData(); } catch { throw new CommsReadError("Invalid multipart body."); }
    const values: Record<string, FormDataEntryValue> = {};
    for (const key of ["mode", "threadId", "view", "to", "cc", "subject", "body"]) {
      const value = form.get(key);
      if (value !== null) values[key] = value;
    }
    const parsed = schema.safeParse(values);
    if (!parsed.success) throw new CommsReadError(parsed.error.issues[0]?.message ?? "Invalid input.");
    const { mode, threadId, to, cc, subject, body } = parsed.data;
    // Pass the original file parts to the web action's outgoingAttachments.
    // It owns the shared count/type/size validation and reads bytes only after validation.
    const result = mode === "new"
      ? await sendNewEmailAction({ to, cc, subject, body, files: form })
      : await sendReplyAction({ threadId: threadId!, toEmail: to, cc, subject, body, replyAll: mode === "replyAll", files: form });
    if (!result.ok) throw new CommsReadError(result.error ?? "Could not send email.");
    return { ok: true };
  });
}
