import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/api-auth";
import { gmailConfigured, sendReply } from "@/lib/gmail";

// POST /api/mobile/inbox/reply — send a reply on a thread (mobile mirror of
// sendReplyAction). Owner only; errors plainly if Gmail isn't connected.
const ReplySchema = z.object({
  threadId: z.string().min(1),
  toEmail: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1, "Reply body is empty."),
});

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!gmailConfigured()) return NextResponse.json({ error: "Gmail is not connected yet." }, { status: 400 });

  let parsed;
  try {
    parsed = ReplySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    await sendReply({
      threadId: parsed.data.threadId,
      toEmail: parsed.data.toEmail,
      subject: parsed.data.subject,
      bodyText: parsed.data.body,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
