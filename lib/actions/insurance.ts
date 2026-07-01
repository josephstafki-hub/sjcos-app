"use server";

// Insurance policy write paths (Phase-4 P4-6). Owner-gated CRUD. Money fields are
// integer dollars. Reads stay in lib/insurance.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { type PolicyType } from "@/lib/insurance-types";

type Result = { ok: boolean; error?: string };

const TYPES: PolicyType[] = ["gl", "wc", "auto", "umbrella", "other"];

function dollars(v: FormDataEntryValue | null): number {
  const n = Math.floor(Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0);
  return n > 0 ? n : 0;
}

/** Create or update a policy. When id is present (>0), updates; else inserts. */
export async function savePolicy(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const id = Number(formData.get("id")) || 0;
  const typeRaw = String(formData.get("policyType") ?? "other") as PolicyType;
  const policyType = TYPES.includes(typeRaw) ? typeRaw : "other";
  const carrier = String(formData.get("carrier") ?? "").trim();
  const policyNumber = String(formData.get("policyNumber") ?? "").trim();
  const coverage = dollars(formData.get("coverage"));
  const premium = dollars(formData.get("premium"));
  const effective = String(formData.get("effective") ?? "").trim();
  const expires = String(formData.get("expires") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (id > 0) {
    await query(
      `UPDATE insurance_policies
          SET policy_type=$2, carrier=$3, policy_number=$4, coverage_amount=$5,
              premium=$6, effective_date=NULLIF($7,'')::date, expires_date=NULLIF($8,'')::date, notes=$9
        WHERE id=$1`,
      [id, policyType, carrier, policyNumber, coverage, premium, effective, expires, notes],
    );
  } else {
    await query(
      `INSERT INTO insurance_policies
         (policy_type, carrier, policy_number, coverage_amount, premium, effective_date, expires_date, notes)
       VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')::date,NULLIF($7,'')::date,$8)`,
      [policyType, carrier, policyNumber, coverage, premium, effective, expires, notes],
    );
  }
  revalidatePath("/compliance");
  return { ok: true };
}

/** Archive (soft-delete) a policy. */
export async function archivePolicy(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE insurance_policies SET archived = true WHERE id = $1`, [id]);
  revalidatePath("/compliance");
  return { ok: true };
}
