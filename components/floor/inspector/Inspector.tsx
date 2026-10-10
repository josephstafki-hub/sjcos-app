"use client";

// Right-hand inspector: an icon tab strip over one of nine panels. The
// shell renders <Inspector> as a 300px column on wide screens and
// <InspectorSheet> as a bottom sheet on narrow ones; both share the body.

import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, BookOpen, History, ImageUp, Layers, MessageSquare, Palette, Settings2, Table2, X } from "lucide-react";
import type { DesignerContext, ViewState } from "../view-state";
import { PropertiesPanel } from "./PropertiesPanel";
import { CatalogPanel } from "./CatalogPanel";
import { MaterialsPanel } from "./MaterialsPanel";
import { LayersPanel } from "./LayersPanel";
import { RoomsPanel } from "./RoomsPanel";
import { ChecksPanel, useChecks } from "./ChecksPanel";
import { CommentsPanel } from "./CommentsPanel";
import { VersionsPanel } from "./VersionsPanel";
import { UnderlayPanel } from "./UnderlayPanel";

type PanelKey = ViewState["panel"];

const TABS: { key: PanelKey; label: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { key: "properties", label: "Properties", Icon: Settings2 },
  { key: "underlay", label: "Trace a plan", Icon: ImageUp },
  { key: "catalog", label: "Catalog", Icon: BookOpen },
  { key: "materials", label: "Materials", Icon: Palette },
  { key: "layers", label: "Layers", Icon: Layers },
  { key: "rooms", label: "Rooms", Icon: Table2 },
  { key: "checks", label: "Checks", Icon: AlertTriangle },
  { key: "comments", label: "Comments", Icon: MessageSquare },
  { key: "versions", label: "Versions", Icon: History },
];

function TabStrip({ ctx }: { ctx: DesignerContext }) {
  const checks = useChecks(ctx);
  const ignored = new Set(ctx.d.doc.ignoredChecks);
  const warnCount = checks.filter((c) => c.severity === "warn" && !ignored.has(c.id)).length;
  const commentCount = ctx.comments.filter((c) => !c.resolvedAt).length;
  const badge = (k: PanelKey) => (k === "checks" ? warnCount : k === "comments" ? commentCount : 0);
  return (
    <div className="flex flex-none border-b border-rule bg-paper">
      {TABS.map(({ key, label, Icon }) => {
        const active = ctx.view.panel === key;
        const n = badge(key);
        return (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            data-tab={key}
            aria-pressed={active}
            onClick={() => ctx.setView({ panel: key })}
            className={`relative flex flex-1 items-center justify-center py-2 transition-colors ${
              active ? "border-b-2 border-ink text-ink" : "border-b-2 border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {n > 0 && (
              <span
                className={`absolute right-1 top-1 min-w-[14px] rounded-full px-1 text-center font-mono text-[8.5px] font-semibold leading-[14px] ${
                  key === "checks" ? "bg-flag text-paper" : "bg-info text-paper"
                }`}
              >
                {n > 99 ? "99+" : n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PanelBody({ ctx }: { ctx: DesignerContext }) {
  switch (ctx.view.panel) {
    case "properties":
      return <PropertiesPanel ctx={ctx} />;
    case "underlay":
      return <UnderlayPanel ctx={ctx} />;
    case "catalog":
      return <CatalogPanel ctx={ctx} />;
    case "materials":
      return <MaterialsPanel ctx={ctx} />;
    case "layers":
      return <LayersPanel ctx={ctx} />;
    case "rooms":
      return <RoomsPanel ctx={ctx} />;
    case "checks":
      return <ChecksPanel ctx={ctx} />;
    case "comments":
      return <CommentsPanel ctx={ctx} />;
    case "versions":
      return <VersionsPanel ctx={ctx} />;
  }
}

function PanelTitle({ ctx, right }: { ctx: DesignerContext; right?: ReactNode }) {
  const tab = TABS.find((t) => t.key === ctx.view.panel);
  return (
    <div className="flex flex-none items-center gap-2 px-3 pt-2.5">
      <div className="flex-1 font-serif text-[15px] font-semibold text-ink">{tab?.label}</div>
      {right}
    </div>
  );
}

/** Wide-screen column. */
export function Inspector({ ctx }: { ctx: DesignerContext }) {
  return (
    <aside className="flex h-full w-[300px] flex-none flex-col border-l border-rule bg-paper">
      <TabStrip ctx={ctx} />
      <PanelTitle ctx={ctx} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
        <PanelBody ctx={ctx} />
      </div>
    </aside>
  );
}

/** Narrow-screen bottom sheet. The shell decides when to render it; onClose
 *  is optional (the shell may hide the sheet through its own state). */
export function InspectorSheet({ ctx, onClose }: { ctx: DesignerContext; onClose?: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-[45vh] flex-col rounded-t-xl border-t border-rule bg-paper shadow-[0_-8px_24px_rgba(0,0,0,.12)]">
      <div className="flex flex-none items-center justify-center py-1.5">
        <span className="h-1 w-10 rounded-full bg-ink-4" />
      </div>
      <TabStrip ctx={ctx} />
      <PanelTitle
        ctx={ctx}
        right={
          onClose ? (
            <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
              <X className="size-4" strokeWidth={1.5} />
            </button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
        <PanelBody ctx={ctx} />
      </div>
    </div>
  );
}
