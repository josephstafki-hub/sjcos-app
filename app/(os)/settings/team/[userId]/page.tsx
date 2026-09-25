import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { normalizePermissions } from "@/lib/permissions";
import { authoritySummary } from "@/lib/authority/grants";
import { runDirect } from "@/lib/commands/db";
import { AreasSummary, AuthorityEditor } from "@/components/settings/Authority";
import { StaffAccessButton } from "@/components/settings/TeamAccess";

export const dynamic = "force-dynamic";

/** Settings › Team › one team member: AREAS (visibility) and MAY APPROVE
 *  (authority) as two distinct sections. Owner-only — /settings is in
 *  OWNER_ONLY_PATHS and requireRole backs it. */
export default async function TeamMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireRole("owner");
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const user = await queryOne<{
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    permissions: string[] | null;
    last_permission_change_at: string | null;
  }>(
    `SELECT id, name, email, role, active, permissions, last_permission_change_at::text AS last_permission_change_at FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) notFound();
  const perms = user.role === "staff" ? normalizePermissions(user.permissions) : [];
  const [{ live, revoked }, projects, audit] = await Promise.all([
    user.role === "staff" ? authoritySummary(runDirect, user.id) : Promise.resolve({ live: [], revoked: [] }),
    query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE status <> 'archived' ORDER BY name`).then((r) => r.rows),
    query<{ change: string; actor_label: string; detail: Record<string, unknown>; created_at: string }>(
      `SELECT change, actor_label, detail, created_at::text AS created_at FROM permission_audit WHERE subject_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [user.id],
    ).then((r) => r.rows),
  ]);

  return (
    <Shell breadcrumb="SETTINGS · TEAM">
      <div className="mx-auto max-w-[820px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>
            <Link href="/settings" className="hover:underline">
              Team &amp; roles
            </Link>{" "}
            · {user.role}
            {!user.active ? " · disabled" : ""}
          </Eyebrow>
          <h1 className="mt-1 font-serif text-[30px] font-medium leading-none tracking-tight text-accent-2">{user.name}</h1>
          <p className="mt-1 text-[12px] text-ink-3">
            {user.email}
            {user.last_permission_change_at ? ` · permissions last changed ${new Date(user.last_permission_change_at).toLocaleString("en-US")}` : ""}
          </p>
        </div>

        {user.role !== "staff" ? (
          <Card className="p-4 text-[13px] text-ink-2">
            {user.role === "owner"
              ? "An owner account sees and may approve everything. Authority is not assigned per type."
              : "Portal logins (sub / client) hold no areas and no approval authority."}
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Areas · what they can open</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">Visibility only. Seeing a tab never lets them approve anything on it.</div>
                </div>
                <StaffAccessButton id={user.id} name={user.name} email={user.email} permissions={perms} />
              </div>
              <AreasSummary permissions={perms} />
              {perms.includes("ai") && (
                <div className="mt-2 rounded-md border border-flag/40 bg-flag/5 px-3 py-2 text-[11px] text-ink-2">
                  Holds the AI panel: their agent runs use the <strong>business profile</strong> (sjcos tools scoped to their areas
                  and the authority below; no code, shell, web or repo access). They can never start an operator run.
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Authority · what they may approve</div>
              <AuthorityEditor userId={user.id} userName={user.name} live={live} revoked={revoked} projects={projects} />
            </Card>

            <Card className="p-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Permission history</div>
              {audit.length === 0 ? (
                <div className="text-[12px] text-ink-3">No changes recorded yet.</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {audit.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12px] text-ink-2">
                      <Chip kind="ghost">{a.change}</Chip>
                      <span className="text-ink-3">{a.actor_label}</span>
                      <span className="ml-auto font-mono text-[10px] text-ink-3">{new Date(a.created_at).toLocaleString("en-US")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}
