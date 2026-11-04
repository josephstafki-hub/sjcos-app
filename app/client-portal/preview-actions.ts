"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { queryOne } from "@/lib/db";

export async function selectPreviewProject(formData: FormData) {
  await requireRole("owner");
  const slug = String(formData.get("project") ?? "");
  if (slug && !await queryOne("SELECT slug FROM projects WHERE slug = $1", [slug])) {
    throw new Error("Choose an existing project.");
  }
  (await cookies()).set("portal_preview_project", slug, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/client-portal", maxAge: 60 * 60 * 8,
  });
  revalidatePath("/client-portal", "layout");
}
