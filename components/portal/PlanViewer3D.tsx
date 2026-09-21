"use client";

// Read-only 3D viewer for the client portal (docs/floor-plan-designer-plan.md
// §10, "Portal 3D"). Wraps the designer's Scene3D with a touch-sized toolbar
// (orbit / walk / top, dollhouse, day / night, levels, saved cameras) and a
// "pin a comment" mode: tap an element in 3D and a comment form opens
// anchored to it. No editing — the doc is a published snapshot.

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Eye, Footprints, LayoutGrid, MapPin, Moon, RotateCcw, Sun, Video } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { Scene3DLoader, type CameraMode, type Scene3DHandle } from "@/components/floor/Scene3DLoader";
import type { Camera as PlanCamera, PlanDoc, Pt } from "@/lib/plan-doc";
import { centroid } from "@/lib/plan-geometry";
import type { CommentAnchor } from "@/lib/actions/plan-comments";
import { PlanCommentForm } from "./PlanCommentForm";

export interface PortalPlanComment {
  id: number;
  authorRole: "owner" | "staff" | "client" | "agent";
  authorName: string;
  body: string;
  createdLabel: string;
  anchor: CommentAnchor;
  resolved: boolean;
}

interface Pin {
  anchor: CommentAnchor;
  label: string;
}

const BTN = "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition-colors";
const BTN_IDLE = `${BTN} border-rule bg-card text-ink-2 hover:bg-paper-2`;
const BTN_ON = `${BTN} border-accent bg-accent-soft text-accent-2`;

/** Where a picked element sits in plan space, plus a human label. Falls back
 *  to the level's first room centroid (or the wall bounds' centre) so a
 *  general comment still lands somewhere sensible. */
function anchorFor(doc: PlanDoc, levelId: string, id: string | null): Pin {
  if (id) {
    const item = doc.items.find((i) => i.id === id);
    if (item) {
      return {
        anchor: { levelId: item.levelId, x: item.x, y: item.y, itemId: item.id },
        label: item.label || item.tag || "this item",
      };
    }
    const room = doc.rooms.find((r) => r.id === id);
    if (room) {
      const c = centroid(room.polygon);
      return { anchor: { levelId: room.levelId, x: c.x, y: c.y, itemId: room.id }, label: room.name || "this room" };
    }
    const wall = doc.walls.find((w) => w.id === id);
    if (wall) {
      return {
        anchor: { levelId: wall.levelId, x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2, itemId: wall.id },
        label: "this wall",
      };
    }
    const opening = doc.openings.find((o) => o.id === id);
    if (opening) {
      const w = doc.walls.find((x) => x.id === opening.wallId);
      if (w) {
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
        const t = (opening.atIn + opening.widthIn / 2) / len;
        return {
          anchor: { levelId: w.levelId, x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t, itemId: opening.id },
          label: opening.kind === "window" ? "this window" : opening.kind === "door" ? "this door" : "this opening",
        };
      }
    }
    const counter = doc.counters.find((c) => c.id === id);
    if (counter) {
      const c = centroid(counter.polygon);
      return { anchor: { levelId: counter.levelId, x: c.x, y: c.y, itemId: counter.id }, label: "this countertop" };
    }
    const finish = doc.finishes.find((f) => f.id === id);
    if (finish?.polygon?.length) {
      const c = centroid(finish.polygon);
      return { anchor: { levelId: finish.levelId, x: c.x, y: c.y, itemId: finish.id }, label: "this finish" };
    }
  }
  const room = doc.rooms.find((r) => r.levelId === levelId);
  if (room) {
    const c = centroid(room.polygon);
    return { anchor: { levelId, x: c.x, y: c.y }, label: "the whole plan" };
  }
  const pts: Pt[] = doc.walls.filter((w) => w.levelId === levelId).flatMap((w) => [w.a, w.b]);
  const c = pts.length ? centroid(pts) : { x: 0, y: 0 };
  return { anchor: { levelId, x: c.x, y: c.y }, label: "the whole plan" };
}

export function PlanViewer3D({
  doc,
  floorplanId,
  comments,
  signerName,
  canComment,
  viewerRole,
}: {
  doc: PlanDoc;
  floorplanId: number;
  comments: PortalPlanComment[];
  signerName: string;
  canComment: boolean;
  /** Which chip reads "You" in the comment list. */
  viewerRole: "client" | "owner";
}) {
  const scene = useRef<Scene3DHandle>(null);
  const firstLevel = doc.levels[0]?.id ?? "";
  const [levelId, setLevelId] = useState<string | "all">(firstLevel);
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [dollhouse, setDollhouse] = useState(true);
  const [night, setNight] = useState(false);
  const [camera, setCamera] = useState<PlanCamera | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);

  // Level the pin/default anchor belongs to when "all" is showing.
  const anchorLevel = levelId === "all" ? firstLevel : levelId;

  const cameras = useMemo(
    () => (levelId === "all" ? doc.cameras : doc.cameras.filter((c) => c.levelId === levelId)),
    [doc.cameras, levelId],
  );

  const onSelect = useCallback(
    (id: string | null) => {
      setSelectedIds(id ? [id] : []);
      // Only an actual element opens the form — a missed click (which the
      // canvas also reports after an orbit drag) leaves things as they are.
      if (pinMode && id) setPin(anchorFor(doc, anchorLevel, id));
    },
    [pinMode, doc, anchorLevel],
  );

  function togglePin() {
    setPinMode((on) => {
      if (on) setPin(null);
      return !on;
    });
  }

  function commentOnPlan() {
    setPinMode(true);
    setPin(anchorFor(doc, anchorLevel, null));
  }

  function flyTo(cam: PlanCamera) {
    setMode(cam.mode);
    setCamera(cam);
    scene.current?.flyTo(cam);
  }

  function resetView() {
    setCamera(null);
    scene.current?.fit();
  }

  function pickMode(m: CameraMode) {
    setMode(m);
    setCamera(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-rule">
          <ModeButton on={mode === "orbit"} onClick={() => pickMode("orbit")} icon={<Box className="size-3.5" strokeWidth={1.75} />}>
            Orbit
          </ModeButton>
          <ModeButton on={mode === "walk"} onClick={() => pickMode("walk")} icon={<Footprints className="size-3.5" strokeWidth={1.75} />}>
            Walk
          </ModeButton>
          <ModeButton on={mode === "plan"} onClick={() => pickMode("plan")} icon={<LayoutGrid className="size-3.5" strokeWidth={1.75} />}>
            Top
          </ModeButton>
        </div>

        <button type="button" onClick={() => setDollhouse((d) => !d)} className={dollhouse ? BTN_ON : BTN_IDLE} aria-pressed={dollhouse}>
          <Eye className="size-3.5" strokeWidth={1.75} />
          Dollhouse
        </button>
        <button type="button" onClick={() => setNight((n) => !n)} className={night ? BTN_ON : BTN_IDLE} aria-pressed={night}>
          {night ? <Moon className="size-3.5" strokeWidth={1.75} /> : <Sun className="size-3.5" strokeWidth={1.75} />}
          {night ? "Night" : "Day"}
        </button>

        {doc.levels.length > 1 && (
          <label className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-rule bg-card px-2.5 text-[12px] font-semibold text-ink-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Level</span>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              className="bg-transparent text-[12px] font-semibold text-ink focus:outline-none"
            >
              {doc.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="all">All levels</option>
            </select>
          </label>
        )}

        <button type="button" onClick={resetView} className={BTN_IDLE}>
          <RotateCcw className="size-3.5" strokeWidth={1.75} />
          Reset view
        </button>

        <div className="flex-1" />

        {canComment && (
          <button type="button" onClick={togglePin} className={pinMode ? BTN_ON : BTN_IDLE} aria-pressed={pinMode}>
            <MapPin className="size-3.5" strokeWidth={1.75} />
            {pinMode ? "Pinning — tap the plan" : "Pin a comment"}
          </button>
        )}
      </div>

      {cameras.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Views</span>
          {cameras.map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => flyTo(cam)}
              className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-[12px] font-medium ${
                camera?.id === cam.id ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
              }`}
            >
              <Video className="size-3" strokeWidth={1.75} />
              {cam.name || "View"}
            </button>
          ))}
        </div>
      )}

      {/* Scene — Scene3D fills its parent, so the parent carries the height. */}
      <div
        className={`relative h-[60vh] min-h-[360px] overflow-hidden rounded-md border bg-paper-2 ${
          pinMode ? "border-accent" : "border-rule"
        }`}
      >
        <Scene3DLoader
          ref={scene}
          doc={doc}
          levelId={levelId}
          phase="new"
          selectedIds={selectedIds}
          onSelect={onSelect}
          mode={mode}
          renderStyle="materials"
          dollhouse={dollhouse}
          night={night}
          sunHour={14}
          section={null}
          showLabels={false}
          camera={camera}
        />
        {pinMode && !pin && (
          <div className="pointer-events-none absolute top-2 left-2 rounded border border-accent bg-paper/90 px-2 py-1 font-mono text-[10px] text-accent-2">
            Tap a room, wall, or item to comment on it
          </div>
        )}
      </div>

      <p className="font-mono text-[10px] leading-snug text-ink-3">
        Drag to orbit · scroll or pinch to zoom · walk: WASD / drag to look · top: drag to pan
      </p>

      {pinMode && !pin && canComment && (
        <button type="button" onClick={commentOnPlan} className={`${BTN_IDLE} self-start`}>
          <MapPin className="size-3.5" strokeWidth={1.75} />
          Or comment on the whole plan
        </button>
      )}

      {pin && canComment && (
        <PlanCommentForm
          key={`${pin.anchor.levelId}:${pin.anchor.itemId ?? "plan"}:${pin.anchor.x}:${pin.anchor.y}`}
          floorplanId={floorplanId}
          anchor={pin.anchor}
          anchorLabel={pin.label}
          defaultName={signerName}
          onClose={() => {
            setPin(null);
            setPinMode(false);
          }}
        />
      )}

      {/* Comments */}
      <div className="mt-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
          Comments{comments.length > 0 ? ` · ${comments.length}` : ""}
        </span>
        {comments.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
            No comments on this version yet.
            {canComment ? " Use “Pin a comment” to tell Joe what you'd like changed." : ""}
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-2">
            {comments.map((c) => {
              const mine = c.authorRole === viewerRole || (viewerRole === "owner" && c.authorRole === "staff");
              const where = anchorLabel(doc, c.anchor);
              return (
                <li key={c.id}>
                  <Card className="p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {mine ? (
                        <Chip kind="accent" dot>
                          You
                        </Chip>
                      ) : c.authorRole === "client" ? (
                        <Chip kind="info" dot>
                          {c.authorName || "Client"}
                        </Chip>
                      ) : (
                        <Chip kind="money" dot>
                          Joe
                        </Chip>
                      )}
                      {where && <span className="font-mono text-[10px] text-ink-3">on {where}</span>}
                      <span className="font-mono text-[10px] text-ink-4">{c.createdLabel}</span>
                      <div className="flex-1" />
                      {c.resolved && <Chip kind="ghost">resolved</Chip>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{c.body}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Label for an existing comment's anchor: the item/room it was pinned to,
 *  else the room containing the point, else the level. */
function anchorLabel(doc: PlanDoc, a: CommentAnchor): string {
  if (a.itemId) {
    const item = doc.items.find((i) => i.id === a.itemId);
    if (item) return item.label || item.tag || "an item";
    const room = doc.rooms.find((r) => r.id === a.itemId);
    if (room) return room.name || "a room";
    if (doc.walls.some((w) => w.id === a.itemId)) return "a wall";
    const opening = doc.openings.find((o) => o.id === a.itemId);
    if (opening) return opening.kind === "window" ? "a window" : opening.kind === "door" ? "a door" : "an opening";
    if (doc.counters.some((c) => c.id === a.itemId)) return "a countertop";
  }
  const room = doc.rooms.find((r) => r.levelId === a.levelId && pointInPolygon({ x: a.x, y: a.y }, r.polygon));
  if (room) return room.name || "a room";
  const level = doc.levels.find((l) => l.id === a.levelId);
  return doc.levels.length > 1 && level ? level.name : "";
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function ModeButton({
  on,
  onClick,
  icon,
  children,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex min-h-9 items-center gap-1.5 px-3 text-[12px] font-semibold transition-colors ${
        on ? "bg-accent-soft text-accent-2" : "bg-card text-ink-2 hover:bg-paper-2"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
