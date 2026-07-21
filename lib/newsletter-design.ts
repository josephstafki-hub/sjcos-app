// Newsletter design vocabulary (P7-N). Pure data + types, NO db import — the
// client editor, the pure renderer (lib/newsletter-render.ts) and the server
// actions all import from here.
//
// ON CUSTOM FONTS: email clients are not browsers. Gmail's web/mobile clients,
// Outlook desktop and Yahoo all strip @font-face, so a genuinely custom uploaded
// font would silently fall back to Times New Roman for most of the list — worse
// than choosing well from the fonts that ARE installed everywhere. So the font
// picker offers curated stacks instead: each one leads with a distinctive face
// and degrades through near-identical metrics rather than off a cliff.

export type FontKey = "georgia" | "helvetica" | "palatino" | "trebuchet" | "courier" | "system";

export interface FontChoice {
  key: FontKey;
  label: string;
  /** Where it lands, honestly stated — shown under the picker. */
  note: string;
  stack: string;
}

export const NEWSLETTER_FONTS: FontChoice[] = [
  {
    key: "georgia",
    label: "Georgia",
    note: "Warm serif. Installed on effectively every device — the safest choice.",
    stack: "Georgia, 'Times New Roman', Times, serif",
  },
  {
    key: "helvetica",
    label: "Helvetica / Arial",
    note: "Clean sans. Universal; reads well at small sizes on phones.",
    stack: "Helvetica, Arial, sans-serif",
  },
  {
    key: "palatino",
    label: "Palatino",
    note: "Bookish serif with more character. Falls back to Georgia.",
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  {
    key: "trebuchet",
    label: "Trebuchet",
    note: "Friendly, slightly rounded sans. Falls back to Arial.",
    stack: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif",
  },
  {
    key: "courier",
    label: "Courier",
    note: "Typewriter monospace. Distinctive, but heavy in long paragraphs.",
    stack: "'Courier New', Courier, monospace",
  },
  {
    key: "system",
    label: "System default",
    note: "Matches whatever the reader's device uses natively.",
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
];

export function getFont(key: string | null | undefined): FontChoice {
  return NEWSLETTER_FONTS.find((f) => f.key === key) ?? NEWSLETTER_FONTS[0];
}

/** Per-issue design settings, persisted in newsletters.settings (jsonb). */
export interface IssueSettings {
  font: FontKey;
  /** Headline + button + rule color. Hex, validated on save. */
  accent: string;
  /** Body text size in px — 14 reads small on desktop, 16 is the modern default. */
  bodySize: number;
  showLogo: boolean;
  /** Sign-off above the unsubscribe line. */
  footer: string;
}

export const DEFAULT_SETTINGS: IssueSettings = {
  font: "georgia",
  accent: "#4a5d3a",
  bodySize: 16,
  showLogo: true,
  footer: "SJ Carpentry LLC · Reply to this email any time.",
};

/** A few one-click palettes so a non-designer never has to reason about hex. */
export const ACCENT_PRESETS: { label: string; value: string }[] = [
  { label: "Workshop green", value: "#4a5d3a" },
  { label: "Walnut", value: "#5c4433" },
  { label: "Slate", value: "#3f4a55" },
  { label: "Barn red", value: "#7a3b32" },
  { label: "Ink", value: "#1c1c1c" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Coerce whatever is in the jsonb column (or arriving from the client) into a
 *  complete, safe settings object. Unknown/malformed fields fall back rather than
 *  throwing — an issue must always be openable in the editor. The accent is
 *  hex-validated here specifically because it is interpolated into inline CSS in
 *  the rendered email. */
export function normalizeSettings(raw: unknown): IssueSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<IssueSettings>;
  const size = Number(s.bodySize);
  return {
    font: NEWSLETTER_FONTS.some((f) => f.key === s.font) ? (s.font as FontKey) : DEFAULT_SETTINGS.font,
    accent: typeof s.accent === "string" && HEX.test(s.accent) ? s.accent : DEFAULT_SETTINGS.accent,
    bodySize: Number.isFinite(size) && size >= 12 && size <= 22 ? Math.round(size) : DEFAULT_SETTINGS.bodySize,
    showLogo: typeof s.showLogo === "boolean" ? s.showLogo : DEFAULT_SETTINGS.showLogo,
    footer:
      typeof s.footer === "string" && s.footer.trim()
        ? s.footer.trim().slice(0, 400)
        : DEFAULT_SETTINGS.footer,
  };
}
