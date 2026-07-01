// Client-safe sub-document constants — NO db import, so the upload form can use
// them without dragging pg into the browser bundle (see catalog-categories.ts).

export type SubDocType = "w9" | "coi" | "agreement" | "other";

export const SUB_DOC_LABEL: Record<SubDocType, string> = {
  w9: "W-9",
  coi: "COI (insurance)",
  agreement: "Sub agreement",
  other: "Other",
};

export const SUB_DOC_TYPES: { value: SubDocType; label: string }[] = [
  { value: "coi", label: "COI (insurance)" },
  { value: "w9", label: "W-9" },
  { value: "agreement", label: "Sub agreement" },
  { value: "other", label: "Other" },
];
