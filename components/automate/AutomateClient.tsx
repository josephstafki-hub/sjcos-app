"use client";

import { useState, useTransition } from "react";
import { Sparkles, FileText, Clock, Terminal, Check, AlertTriangle } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import type { ChipKind } from "@/components/ui";
import type { AutomationPlan, AutomationStep } from "@/lib/automate";
import { proposeAction, executeAction, installCronAction } from "@/lib/actions/automate";

type Phase = "idle" | "planned" | "built";

const RISK_CHIP: Record<AutomationPlan["risk"], ChipKind> = {
  low: "ghost",
  medium: "ai",
  high: "flag",
};

const STEP_ICON: Record<AutomationStep["type"], typeof FileText> = {
  write_file: FileText,
  cron: Clock,
  shell: Terminal,
};

function StepRow({ step }: { step: AutomationStep }) {
  const Icon = STEP_ICON[step.type];
  return (
    <div className="flex gap-3 border-t border-rule-soft py-3 first:border-t-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Chip kind="default">{step.type.replace("_", " ")}</Chip>
          {step.path && (
            <span className="truncate font-mono text-[11px] text-ink-2">{step.path}</span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{step.description}</p>
        {step.type === "cron" && (
          <p className="mt-1 font-mono text-[11px] text-ink-3">
            {step.schedule} <span className="text-ink-4">·</span> {step.command}
          </p>
        )}
        {step.contentPreview && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-rule bg-paper-2 p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
            {step.contentPreview}
          </pre>
        )}
      </div>
    </div>
  );
}

export function AutomateClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<AutomationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exec, setExec] = useState<{ output: string; costUsd?: number; stagedCron: string[] } | null>(null);
  const [install, setInstall] = useState<{ installed: string[]; skipped: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setPhase("idle");
    setPlan(null);
    setError(null);
    setExec(null);
    setInstall(null);
  }

  function onPropose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("instruction", instruction);
    startTransition(async () => {
      const res = await proposeAction({}, fd);
      if (res.error) return setError(res.error);
      setPlan(res.plan ?? null);
      setPhase("planned");
    });
  }

  function onBuild() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await executeAction(instruction, plan);
      if (res.error) return setError(res.error);
      setExec({ output: res.output ?? "", costUsd: res.costUsd, stagedCron: res.stagedCron ?? [] });
      setPhase("built");
    });
  }

  function onInstallCron() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await installCronAction(plan);
      if (res.error) return setError(res.error);
      setInstall({ installed: res.installed ?? [], skipped: res.skipped ?? [] });
    });
  }

  return (
    <div className="mx-auto max-w-[760px] px-6 py-6">
      <Eyebrow>Automation builder</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] leading-tight text-ink">
        Describe an automation in plain English
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Claude drafts a concrete plan you review before anything is created. Setup runs once;
        recurring work runs locally for free.
      </p>

      {/* Step 1 — instruction */}
      <form onSubmit={onPropose} className="mt-5">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="e.g. Every Monday at 8am, summarize last week's completed jobs into a markdown report."
          className="w-full resize-y rounded-md border border-rule bg-paper px-3 py-2.5 text-[14px] text-ink outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending || !instruction.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
          >
            <Sparkles className="size-3.5" strokeWidth={1.5} />
            {phase === "idle" ? "Plan it" : "Re-plan"}
          </button>
          {phase !== "idle" && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
            >
              Start over
            </button>
          )}
          {pending && <span className="text-[12px] text-ink-3">Working…</span>}
        </div>
      </form>

      {error && (
        <Card kind="flag" className="mt-4 flex items-start gap-2 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-flag" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-2">{error}</p>
        </Card>
      )}

      {/* Step 2 — review the proposed plan */}
      {plan && (
        <Card className="mt-5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-[18px] text-ink">{plan.title}</h2>
              <p className="mt-1 text-[13px] text-ink-2">{plan.summary}</p>
            </div>
            <Chip kind={RISK_CHIP[plan.risk]}>{plan.risk} risk</Chip>
          </div>

          <div className="mt-3">
            {plan.steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
          </div>

          {phase === "planned" && (
            <div className="mt-3 flex items-center gap-2 border-t border-rule pt-3">
              <button
                onClick={onBuild}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:opacity-90 disabled:opacity-40"
              >
                <Check className="size-3.5" strokeWidth={2} />
                Approve &amp; build
              </button>
              <span className="text-[12px] text-ink-3">
                Writes files into <span className="font-mono">automations/</span> only. Cron is staged, not installed.
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Step 3 — build result + gated cron install */}
      {exec && (
        <Card kind="soft" className="mt-4 p-4">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-accent-2" strokeWidth={2} />
            <Eyebrow>Built</Eyebrow>
            {typeof exec.costUsd === "number" && (
              <span className="ml-auto font-mono text-[11px] text-ink-3">
                setup cost ${exec.costUsd.toFixed(3)}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-snug text-ink-2">{exec.output}</p>

          {exec.stagedCron.length > 0 && (
            <div className="mt-3 border-t border-rule pt-3">
              <Eyebrow muted>Cron staged — not yet installed</Eyebrow>
              <pre className="mt-2 overflow-auto rounded-md border border-rule bg-paper-2 p-2.5 font-mono text-[11px] text-ink-2">
                {exec.stagedCron.join("\n")}
              </pre>
              {!install ? (
                <button
                  onClick={onInstallCron}
                  disabled={pending}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
                >
                  <Clock className="size-3.5" strokeWidth={1.5} />
                  Install cron
                </button>
              ) : (
                <div className="mt-2 text-[12px] text-ink-2">
                  {install.installed.length > 0 && (
                    <p className="text-accent-2">✓ Installed {install.installed.length} cron line(s).</p>
                  )}
                  {install.skipped.length > 0 && (
                    <p className="text-ink-3">Skipped {install.skipped.length} already present.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
