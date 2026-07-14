// E-signature shared types + pure constants. NO db import — safe to import from
// client components (the owner request form + client sign modal both need the
// doc-type list). Mirrors the lib/catalog-categories.ts split so pg never leaks
// into a client bundle.

export type DocType =
  | "design"
  | "estimate"
  | "contract"
  | "sow"
  | "change_order"
  | "completion"
  | "lien_waiver"
  | "precon"
  | "other";

export type SigStatus = "draft" | "sent" | "signed" | "declined" | "void";

export const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "contract", label: "Contract" },
  { value: "estimate", label: "Estimate" },
  { value: "sow", label: "Scope of Work" },
  { value: "change_order", label: "Change order" },
  { value: "design", label: "Design / prints" },
  { value: "other", label: "Other document" },
];

// Labels for every DocType, including the ones generated programmatically
// (completion / lien_waiver / precon) that aren't offered in the manual picker.
const DOC_TYPE_LABELS: Record<DocType, string> = {
  contract: "Contract",
  estimate: "Estimate",
  sow: "Scope of Work",
  change_order: "Change order",
  design: "Design / prints",
  completion: "Certificate of completion",
  lien_waiver: "Lien waiver / release",
  precon: "Pre-construction agreement",
  other: "Other document",
};

export function docTypeLabel(t: DocType): string {
  return DOC_TYPE_LABELS[t] ?? "Document";
}

export const STATUS_LABEL: Record<SigStatus, string> = {
  draft: "Draft",
  sent: "Awaiting signature",
  signed: "Signed",
  declined: "Declined",
  void: "Voided",
};

/** Display shape shared by server reads and the client components. */
export interface SignatureRequestView {
  id: number;
  docType: DocType;
  title: string;
  body: string;
  fileId: string | null;
  status: SigStatus;
  signerName: string;
  signerEmail: string;
  signedName: string | null;
  signedAtLabel: string | null;
  declineReason: string | null;
  createdAtLabel: string;
  sentAtLabel: string | null;
}

export interface SignatureEventView {
  kind: "created" | "sent" | "viewed" | "signed" | "declined" | "voided";
  actor: string;
  detail: string;
  atLabel: string;
}
