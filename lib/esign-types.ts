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

/** How the signature was captured. `typed` is the original portal flow (name
 *  typed + consent), `drawn` adds a hand-drawn signature in the portal, and
 *  `in_person` is a drawn signature captured on the owner's own device (iPad)
 *  with the owner present as witness. */
export type SigMethod = "typed" | "drawn" | "in_person";

export const SIG_METHOD_LABEL: Record<SigMethod, string> = {
  typed: "Typed name in the client portal",
  drawn: "Drawn signature in the client portal",
  in_person: "Signed in person on SJ Carpentry's device",
};

/** The exact consent statement the signer affirms, per method. The checkbox
 *  label in the UI and the quote on the Certificate of Electronic Signature
 *  both read from here so the record matches what was on screen. */
export const CONSENT_STATEMENT: Record<SigMethod, string> = {
  typed: "I agree that typing my name and clicking Sign constitutes my legal electronic signature on this document.",
  drawn: "I agree that drawing my signature and clicking Sign constitutes my legal electronic signature on this document.",
  in_person:
    "I agree that the signature I drew on this device and tapping Sign constitutes my legal electronic signature on this document, with the same effect as a handwritten signature.",
};

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
  signedMethod: SigMethod;
  /** In-person signings: who presented the device (the owner/staff member). */
  witnessName: string | null;
  /** A drawn signature image is on file (stamped into the executed copy). */
  hasSignatureImage: boolean;
}

export type SigEventKind = "created" | "sent" | "viewed" | "presented" | "signed" | "declined" | "voided";

export interface SignatureEventView {
  kind: SigEventKind;
  actor: string;
  detail: string;
  atLabel: string;
}
