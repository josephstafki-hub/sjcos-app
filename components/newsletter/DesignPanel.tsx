"use client";

// Per-issue design settings (P7-N): typeface, accent color, body size, logo,
// footer. Deliberately a short list — every option here has to survive Outlook,
// so the panel offers the choices that actually render rather than a full style
// editor that would lie about what recipients see.

import { Card } from "@/components/ui";
import { ACCENT_PRESETS, NEWSLETTER_FONTS, getFont, type IssueSettings } from "@/lib/newsletter-design";

export function DesignPanel({
  settings,
  locked,
  onChange,
}: {
  settings: IssueSettings;
  locked: boolean;
  onChange: (patch: Partial<IssueSettings>) => void;
}) {
  const font = getFont(settings.font);

  return (
    <div className="mx-auto max-w-[620px] space-y-4">
      {/* Typeface */}
      <Card className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Typeface</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {NEWSLETTER_FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={locked}
              onClick={() => onChange({ font: f.key })}
              style={{ fontFamily: f.stack }}
              className={`rounded-md border px-2.5 py-2 text-[14px] disabled:opacity-60 ${
                settings.font === f.key
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-rule text-ink-2 hover:bg-paper-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-3">{font.note}</p>
        <p className="mt-1.5 rounded-md bg-paper-2 px-2.5 py-1.5 text-[11px] leading-snug text-ink-3">
          Uploaded fonts aren&apos;t offered on purpose: Gmail and Outlook strip custom webfonts, so
          most of your list would silently fall back to Times New Roman. These stacks are installed
          on nearly every device already.
        </p>
      </Card>

      {/* Accent */}
      <Card className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Accent color</div>
        <p className="mt-1 text-[11px] text-ink-3">Headings, buttons and the rule under the title.</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={locked}
              onClick={() => onChange({ accent: p.value })}
              title={p.label}
              style={{ background: p.value }}
              className={`size-7 rounded-full border-2 disabled:opacity-60 ${
                settings.accent.toLowerCase() === p.value.toLowerCase()
                  ? "border-ink"
                  : "border-transparent hover:border-rule"
              }`}
              aria-label={p.label}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            Custom
            <input
              type="color"
              value={settings.accent}
              disabled={locked}
              onChange={(e) => onChange({ accent: e.target.value })}
              className="size-7 cursor-pointer rounded border border-rule bg-paper disabled:opacity-60"
            />
          </label>
          <span className="font-mono text-[11px] text-ink-3">{settings.accent}</span>
        </div>
      </Card>

      {/* Text size */}
      <Card className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Body text size</div>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={12}
            max={22}
            step={1}
            value={settings.bodySize}
            disabled={locked}
            onChange={(e) => onChange({ bodySize: Number(e.target.value) })}
            className="flex-1 accent-accent"
          />
          <span className="w-12 font-mono text-[12px] text-ink-2">{settings.bodySize}px</span>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          16px is the modern default and reads comfortably on a phone; 14px feels cramped to older
          eyes.
        </p>
      </Card>

      {/* Logo + footer */}
      <Card className="p-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={settings.showLogo}
            disabled={locked}
            onChange={(e) => onChange({ showLogo: e.target.checked })}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            <span className="block text-[13px] font-semibold text-ink">Show the SJ Carpentry logo</span>
            <span className="block text-[11px] leading-snug text-ink-3">
              Centered at the top of every issue.
            </span>
          </span>
        </label>
        {settings.showLogo && (
          /* eslint-disable-next-line @next/next/no-img-element -- same file the
             email references, served straight from /public so mail clients can
             fetch it; the Next image pipeline would rewrite the URL. */
          <img
            src="/brand/sjc-logo.png"
            alt="SJ Carpentry LLC"
            className="mt-3 h-10 w-auto opacity-90"
          />
        )}

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Footer</div>
          <textarea
            value={settings.footer}
            disabled={locked}
            onChange={(e) => onChange({ footer: e.target.value })}
            rows={2}
            className="mt-1 w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:bg-paper-2"
          />
          <p className="mt-1 text-[11px] text-ink-3">
            An unsubscribe link is added below this automatically — it&apos;s legally required on
            bulk mail and keeps you out of spam folders.
          </p>
        </div>
      </Card>

      {locked && (
        <p className="text-center text-[11px] text-ink-3">
          This issue is queued or sent — its design is frozen so it matches what went out.
        </p>
      )}
    </div>
  );
}
