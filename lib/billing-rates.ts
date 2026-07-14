// Precon billing-rate metadata — client-safe (no db), shared by the Settings
// editor and the precon auto-resolver (lib/doc-templates/fill.ts) so the labels,
// keys, and defaults can't drift. Defaults are Joe's provided rates (Site Super
// corrected to $62/hr, 2026-07-10). Values are display strings ("$52 / hr").

export const BILLING_RATE_ROWS: { key: string; label: string; default: string }[] = [
  { key: "rates.founder", label: "Founder & CEO", default: "Unbilled" },
  { key: "rates.pm", label: "Project Manager", default: "$52 / hr" },
  { key: "rates.apm", label: "Assistant Project Manager", default: "$36 / hr" },
  { key: "rates.super", label: "Site Superintendent", default: "$62 / hr" },
  { key: "rates.lead_carpenter", label: "Lead Carpenter", default: "$68 / hr" },
  { key: "rates.carpenter", label: "Carpenter", default: "$45 / hr" },
  { key: "rates.apprentice", label: "Apprentice Carpenter", default: "$20 / hr" },
];

/** Third-party markup on subs/materials/permits in the precon agreement. */
export const MARKUP_KEY = "rates.markup";
export const MARKUP_DEFAULT = "20%";
