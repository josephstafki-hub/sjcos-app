import { SettingsSection } from "@/components/settings/SettingsSection";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Chip, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { PERMISSIONS, normalizePermissions } from "@/lib/permissions";
import { authoritySummary } from "@/lib/authority/grants";
import { runDirect } from "@/lib/commands/db";
import { AreasSummary, AuthorityEditor } from "@/components/settings/Authority";
import { UserActiveButton } from "@/components/settings/SettingsClient";
import { AddUserButton, ResetPasswordButton, StaffAccessButton } from "@/components/settings/TeamAccess";

export const dynamic = "force-dynamic";

/** Settings › Team › one team member: AREAS (visibility) and MAY APPROVE
 *  (authority) as two distinct sections. Owner-only — /settings is in
 *  OWNER_ONLY_PATHS and requireRole backs it. */
export default async function TeamMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const viewer = await requireRole("owner");
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
  const [{ live, revoked }, projects, audit, members] = await Promise.all([
    user.role === "staff" ? authoritySummary(runDirect, user.id) : Promise.resolve({ live: [], revoked: [] }),
    query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE status <> 'archived' ORDER BY name`).then((r) => r.rows),
    query<{ change: string; actor_label: string; detail: Record<string, unknown>; created_at: string }>(
      `SELECT change, actor_label, detail, created_at::text AS created_at FROM permission_audit WHERE subject_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [user.id],
    ).then((r) => r.rows),
    query<{ id: string; name: string; email: string; role: string; active: boolean; permissions: string[] | null }>(
      `SELECT id, name, email, role, active, permissions FROM users ORDER BY (role = 'owner') DESC, (role = 'staff') DESC, name`,
    ).then((r) => r.rows),
  ]);

  return (
    <Shell breadcrumb="SETTINGS · TEAM">
      <SettingsSection active="/settings?section=team">
        <div className="flex flex-wrap items-center gap-2"><Button href="/settings?section=team" variant="secondary">Back to team</Button>{user.role !== "owner" && <><UserActiveButton id={user.id} active={user.active} />{user.role !== "staff" && <ResetPasswordButton id={user.id} name={user.name} />}</>}</div>
        <div className="mb-4">
          <PageHeader title={<> {user.name} </>} meta={<> <Link href="/settings?section=team" className="hover:underline">
              Team &amp; roles
            </Link>{" "}
            · {user.role}
            {!user.active ? " · disabled" : ""} </>} />
          <p className="mt-1 text-meta text-ink-3">
            {user.email}
            {user.last_permission_change_at ? ` · permissions last changed ${new Date(user.last_permission_change_at).toLocaleString("en-US")}` : ""}
          </p>
        </div>

        {user.role !== "staff" ? (
          <Card className="space-y-3 p-4 text-body text-ink-2">
            {user.role === "owner" && viewer.id === user.id && <div><Button href="/settings?section=profile" variant="secondary" className="shrink-0">Edit your profile</Button></div>}
            <p>{user.role === "owner"
              ? "An owner account sees and may approve everything. Authority is not assigned per type."
              : "Portal logins (sub / client) hold no areas and no approval authority."}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-meta text-ink-3">Areas · what they can open</div>
                  <div className="mt-0.5 text-meta text-ink-3">Visibility only. Seeing a tab never lets them approve anything on it.</div>
                </div>
                <StaffAccessButton id={user.id} name={user.name} email={user.email} permissions={perms} />
              </div>
              <AreasSummary permissions={perms} />
              {perms.includes("ai") && (
                <div className="mt-2 rounded-md border border-flag/40 bg-flag/5 px-3 py-2 text-meta text-ink-2">
                  Holds the AI panel: their agent runs use the <strong>business profile</strong> (sjcos tools scoped to their areas
                  and the authority below; no code, shell, web or repo access). They can never start an operator run.
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-2 text-meta text-ink-3">Authority · what they may approve</div>
              <AuthorityEditor userId={user.id} userName={user.name} live={live} revoked={revoked} projects={projects} />
            </Card>

            <Card className="p-4">
              <div className="mb-2 text-meta text-ink-3">Permission history</div>
              {audit.length === 0 ? (
                <div className="text-meta text-ink-3">No changes recorded yet.</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {audit.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-meta text-ink-2">
                      <Chip kind="ghost">{a.change}</Chip>
                      <span className="text-ink-3">{a.actor_label}</span>
                      <span className="ml-auto text-meta text-ink-3">{new Date(a.created_at).toLocaleString("en-US")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
        <section aria-label="Team members" className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-heading">Team &amp; roles</h2><AddUserButton />
          </div>
          <div className="divide-y divide-rule-soft">
            {members.map(member => {
              const areas = member.role === "staff" ? normalizePermissions(member.permissions) : [];
              return <div key={member.id} className="space-y-2 py-3">
                <Link href={`/settings/team/${member.id}`} aria-current={member.id === user.id ? "page" : undefined} className="text-subheading font-semibold hover:underline">{member.name}</Link>
                <p className="text-meta text-ink-3">{member.role === "owner" ? "Owner · all areas" : member.role === "staff" ? `Team · ${areas.map(key => PERMISSIONS.find(p => p.key === key)?.label ?? key).join(", ") || "no areas"}` : `${member.role} · portal access`}{!member.active ? " · disabled" : ""}</p>
                {member.role !== "owner" && <div className="flex flex-wrap items-center gap-2">
                  <ResetPasswordButton id={member.id} name={member.name} />
                  {member.role === "staff" && <StaffAccessButton id={member.id} name={member.name} email={member.email} permissions={areas} />}
                  <UserActiveButton id={member.id} active={member.active} />
                </div>}
              </div>;
            })}
          </div>
        </section>
      </SettingsSection>
    </Shell>
  );
}
