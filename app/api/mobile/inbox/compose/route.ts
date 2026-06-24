import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/api-auth";
import { gmailConfigured, sendNewEmail } from "@/lib/gmail";

// POST /api/mobile/inbox/compose — send a brand-new email (mobile mirror of
// sendNewEmailAction). Owner only.
const ComposeSchema = z.object({
  to: z.string().min(1, "Recipient is required."),
  subject: z.string(),
  body: z.string().min(1, "Body is empty."),
});

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!gmailConfigured()) return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });

  let parsed;
  try {
    parsed = ComposeSchema.safeParse(await req.json());
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
    await sendNewEmail({
      to: parsed.data.to.trim(),
      subject: parsed.data.subject,
      bodyText: parsed.data.body,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
