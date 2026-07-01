import "server-only";

// Insurance policy reads (Phase-4 P4-6). Shown on /compliance. Renewal reminders
// live in lib/reminders.ts. Writes stay in lib/actions/insurance.ts.

import { query } from "./db";
import { POLICY_LABEL, type PolicyType } from "./insurance-types";

export interface InsurancePolicy {
  id: number;
  policyType: PolicyType;
  typeLabel: string;
  carrier: string;
  policyNumber: string;
  coverage: number; // dollars
  premium: number; // dollars
  effective: string; // YYYY-MM-DD or ""
  expires: string; // YYYY-MM-DD or ""
  expiresLabel: string;
  daysToExpiry: number | null;
  /** Renewal status derived from days-to-expiry. */
  status: "current" | "expiring" | "expired" | "none";
  notes: string;
}

export async function getInsurancePolicies(): Promise<InsurancePolicy[]> {
  const { rows } = await query<{
    id: number;
    policy_type: PolicyType;
    carrier: string;
    policy_number: string;
    coverage_amount: number;
    premium: number;
    effective: string | null;
    expires: string | null;
    expires_label: string | null;
    days: number | null;
    notes: string;
  }>(
    `SELECT id, policy_type, carrier, policy_number, coverage_amount, premium,
            to_char(effective_date, 'YYYY-MM-DD') AS effective,
            to_char(expires_date, 'YYYY-MM-DD')   AS expires,
            to_char(expires_date, 'Mon FMDD, YYYY') AS expires_label,
            (expires_date - CURRENT_DATE)          AS days,
            notes
       FROM insurance_policies
      WHERE archived = false
      ORDER BY expires_date NULLS LAST, policy_type`,
  );
  return rows.map((r) => {
    const days = r.days;
    let status: InsurancePolicy["status"] = "none";
    if (days !== null) status = days < 0 ? "expired" : days <= 30 ? "expiring" : "current";
    return {
      id: r.id,
      policyType: r.policy_type,
      typeLabel: POLICY_LABEL[r.policy_type] ?? r.policy_type,
      carrier: r.carrier,
      policyNumber: r.policy_number,
      coverage: r.coverage_amount,
      premium: r.premium,
      effective: r.effective ?? "",
      expires: r.expires ?? "",
      expiresLabel: r.expires_label ?? "—",
      daysToExpiry: days,
      status,
      notes: r.notes,
    };
  });
}
