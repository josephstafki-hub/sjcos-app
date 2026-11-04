type ShortcutInput = {
  key: string;
  tagName?: string;
  isContentEditable?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
};

/** Keep single-letter queue actions out of editors and browser shortcuts. */
export function todayShortcut(input: ShortcutInput) {
  if (input.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(input.tagName ?? "") ||
      input.metaKey || input.ctrlKey || input.altKey || input.shiftKey || input.isComposing || input.repeat) return null;
  return ({ j: "next", k: "previous", e: "done", s: "snooze" } as const)[input.key as "j" | "k" | "e" | "s"] ?? null;
}
