// Shared by the app calendar, renewal collection and MCP. Insurance stays in
// its own ledger: editing/archiving a policy immediately changes this view.
export const COMPLIANCE_SOURCE = `
  SELECT id::text AS id, title, due_date, COALESCE(who, '') AS who,
         COALESCE(NULLIF(step, ''), 'Review renewal') AS step,
         COALESCE(dot, 'ghost') AS dot, COALESCE(kind, 'other') AS kind,
         COALESCE(notes, '') AS notes
    FROM compliance_items WHERE NOT resolved
  UNION ALL
  SELECT 'insurance:' || id::text,
         CASE policy_type WHEN 'gl' THEN 'General liability' WHEN 'wc' THEN 'Workers’ compensation'
              WHEN 'auto' THEN 'Auto insurance' WHEN 'umbrella' THEN 'Umbrella insurance' ELSE 'Insurance' END
           || CASE WHEN carrier <> '' THEN ' · ' || carrier ELSE '' END,
         expires_date, carrier, 'Renew policy', 'ghost', 'insurance', COALESCE(notes, '')
    FROM insurance_policies WHERE NOT archived AND expires_date IS NOT NULL
`;
export const CENTRAL_TODAY = "(now() AT TIME ZONE 'America/Chicago')::date";
