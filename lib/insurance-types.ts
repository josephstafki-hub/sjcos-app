// Client-safe insurance constants — NO db import (so the policy form can use
// them without dragging pg into the browser bundle).

export type PolicyType = "gl" | "wc" | "auto" | "umbrella" | "other";

export const POLICY_LABEL: Record<PolicyType, string> = {
  gl: "General Liability",
  wc: "Workers' Comp",
  auto: "Commercial Auto",
  umbrella: "Umbrella",
  other: "Other",
};

export const POLICY_TYPES: { value: PolicyType; label: string }[] = [
  { value: "gl", label: "General Liability" },
  { value: "wc", label: "Workers' Comp" },
  { value: "auto", label: "Commercial Auto" },
  { value: "umbrella", label: "Umbrella" },
  { value: "other", label: "Other" },
];
