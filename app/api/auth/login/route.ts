import { NextResponse } from "next/server";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { encrypt, type Role } from "@/lib/session";

// POST /api/auth/login — token login for the mobile app.
// Verifies credentials and returns the signed JWT (same one the web cookie
// holds) plus the user profile. The native client stores the token securely and
// sends it as `Authorization: Bearer <token>` on every subsequent request.

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = LoginSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await queryOne<{
    id: string;
    email: string;
    name: string;
    role: Role;
    initials: string;
    link_slug: string | null;
    password_hash: string;
    active: boolean;
  }>(
    `SELECT id, email, name, role, initials, link_slug, password_hash, active
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );

  // Same message for unknown email vs. bad password — don't leak which.
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  const token = await encrypt({ userId: user.id, role: user.role });
  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      initials: user.initials,
      linkSlug: user.link_slug,
    },
  });
}
