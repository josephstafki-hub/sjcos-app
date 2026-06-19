// Canonical 5-question lead intake. Kept db-free (no lib/db import) so client
// components — the intake editor — can import this constant without dragging pg
// into the browser bundle (see the pg-in-client gotcha in project notes).

export const INTAKE_QUESTIONS = [
  "Scope",
  "Timeline",
  "Budget",
  "Address",
  "Other bids?",
] as const;
