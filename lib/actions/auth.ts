"use server";

// Auth write paths. login/logout are Server Actions invoked from <form action>.
// login verifies credentials, mints a session cookie, and redirects by role.
// Accounts are owner-provisioned (see lib/actions/users.ts) — there is no public
// signup.

import { redirect } from "next/navigation";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, deleteSession, type Role } from "@/lib/session";
import { homeForRole } from "@/lib/dal";

const LoginSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { email, password } = parsed.data;
  const user = await queryOne<{
    id: string;
    password_hash: string;
    role: Role;
    active: boolean;
  }>(
    `SELECT id, password_hash, role, active FROM users WHERE lower(email) = lower($1)`,
    [email],
  );

  // Same message for unknown email vs. bad password — don't leak which.
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
    return { error: "Wrong email or password." };
  }

  await createSession(user.id, user.role);
  redirect(homeForRole(user.role)); // throws — must be outside try/catch
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
