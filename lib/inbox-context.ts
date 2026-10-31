import { query } from "./db";
export interface InboxContextInput {
  threadId: string;
  email?: string;
  contactKey?: string;
  projectSlug?: string;
  leadSlug?: string;
}
export interface InboxContext {
  person: {
    name: string;
    email: string | null;
    phone: string | null;
    role: "client" | "lead" | "sub" | "vendor";
    slug: string;
  } | null;
  job: {
    slug: string;
    name: string;
    stage: string;
    kind: "project" | "lead";
    money: { total: number; paid: number; outstanding: number } | null;
  } | null;
  schedule: { label: string; day: string; time: string } | null;
  todos: { id: string; title: string; due_at: string | null; assignees?: string }[];
}
/** Panel-only read: no Gmail import or request, and ledger cents are never inferred from invoices. */
export async function loadInboxContext(
  input: InboxContextInput,
): Promise<InboxContext> {
  const email = input.email?.toLowerCase() || null;
  const [kind, key] = input.contactKey?.split(":") ?? [];
  const projectSlug = input.projectSlug || (kind === "project" ? key : null);
  const leadSlug = input.leadSlug || (kind === "lead" ? key : null);
  const { rows: projects } = await query<{
    slug: string;
    name: string;
    stage: string;
    total_cents: string;
    collected_cents: string;
    lead_slug: string | null;
    person_name: string;
    email: string | null;
    phone: string | null;
  }>(
    `SELECT p.slug, p.name, COALESCE(p.stage_label, replace(p.status, '_', ' ')) AS stage,
            p.total_cents::text, p.collected_cents::text, l.slug AS lead_slug,
            COALESCE(NULLIF(p.client_name,''),l.name) AS person_name,
            COALESCE(NULLIF(p.client_email,''),l.email) AS email, l.phone
       FROM projects p LEFT JOIN leads l ON l.id=p.lead_id
      WHERE ($1::text IS NOT NULL AND p.slug=$1)
         OR ($1::text IS NULL AND $2::text IS NOT NULL AND (lower(p.client_email)=$2 OR lower(l.email)=$2))
         OR ($1::text IS NULL AND $3::text IS NOT NULL AND l.slug=$3)
      ORDER BY p.created_at DESC LIMIT 1`,
    [projectSlug, email, leadSlug],
  );
  const p = projects[0];
  const { rows: contacts } = await query<{
    slug: string;
    name: string;
    email: string | null;
    phone: string | null;
    stage: string | null;
    role: "lead" | "sub" | "vendor";
  }>(
    `SELECT slug,name,email,phone,stage,'lead' AS role FROM leads WHERE ($1::text IS NOT NULL AND lower(email)=$1) OR slug=$2
     UNION ALL SELECT slug,name,email,phone,NULL,'sub' FROM subs WHERE ($1::text IS NOT NULL AND lower(email)=$1) OR ($3='sub' AND slug=$4)
     UNION ALL SELECT slug,name,email,phone,NULL,'vendor' FROM vendors WHERE ($1::text IS NOT NULL AND lower(email)=$1) OR ($3='vendor' AND slug=$4)
     LIMIT 5`,
    [email, leadSlug, kind ?? null, key ?? null],
  );
  const c =
    contacts.find((c) => `${c.role}:${c.slug}` === input.contactKey) ??
    contacts.find((c) => c.role === "sub" || c.role === "vendor") ??
    contacts[0];
  const person: InboxContext["person"] =
    c && (c.role === "sub" || c.role === "vendor")
      ? c
      : p
        ? {
            slug: p.lead_slug ?? p.slug,
            name: p.person_name,
            email: p.email,
            phone: p.phone,
            role: "client",
          }
        : (c ?? null);
  const lead = c?.role === "lead" ? c.slug : leadSlug;
  const [schedule, work] = await Promise.all([
    p
      ? query<NonNullable<InboxContext["schedule"]>>(
          `SELECT b.label,to_char(b.block_date,'YYYY-MM-DD') AS day,b.time_label AS time
      FROM schedule_blocks b JOIN projects p ON p.id=b.project_id
      WHERE p.slug=$1 AND b.block_date >= (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY b.block_date,b.sort_min LIMIT 1`,
          [p.slug],
        )
      : Promise.resolve({ rows: [] }),
    query<InboxContext["todos"][number]>(
      `SELECT w.id,w.title,w.due_at,
        COALESCE((SELECT string_agg(u.name,', ' ORDER BY u.name) FROM work_item_assignees a JOIN users u ON u.id=a.user_id WHERE a.work_item_id=w.id),'Joe') AS assignees
        FROM work_items w
      LEFT JOIN projects p ON p.id=w.project_id LEFT JOIN leads l ON l.id=w.lead_id
      WHERE (p.slug=$1 OR l.slug=$2 OR w.source_id=$3 OR w.obligation_id IN
        (SELECT obligation_id FROM obligation_sources WHERE thread_id=$3))
        AND w.status NOT IN ('done', 'cancelled') AND w.archived_at IS NULL
      ORDER BY w.due_at NULLS LAST,w.created_at DESC LIMIT 8`,
      [p?.slug ?? null, lead ?? null, input.threadId],
    ),
  ]);
  return {
    person,
    job: p
      ? {
          slug: p.slug,
          name: p.name,
          stage: p.stage,
          kind: "project",
          money: {
            total: Number(p.total_cents),
            paid: Number(p.collected_cents),
            outstanding: Math.max(
              0,
              Number(p.total_cents) - Number(p.collected_cents),
            ),
          },
        }
      : c?.role === "lead"
        ? {
            slug: c.slug,
            name: c.name,
            stage: c.stage?.replaceAll("_", " ") ?? "",
            kind: "lead",
            money: null,
          }
        : null,
    schedule: schedule.rows[0] ?? null,
    todos: work.rows,
  };
}
