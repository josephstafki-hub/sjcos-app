import type { MoodBoardData, MoodItem } from "@/lib/mood";

// Read-only render of a mood board for the client portal. Mirrors the owner
// canvas's surface + item rendering (components/projects/MoodCanvas.tsx) —
// same 16/10 aspect, same normalized geometry, same auto-grid for unplaced
// items — with every gesture stripped. Server component: nothing to hydrate.

const COLS = 4;
const ROWS = 3;

/** Where an unplaced item lands — keep in lockstep with MoodCanvas.autoPos so
 *  the client sees the same board the owner curated. */
function autoPos(i: number) {
  const slot = i % (COLS * ROWS);
  const off = Math.floor(i / (COLS * ROWS)) * 0.02;
  return {
    x: 0.04 + (slot % COLS) * 0.24 + off,
    y: 0.05 + Math.floor(slot / COLS) * 0.3 + off,
    w: 0.21,
    h: null as number | null,
    rot: 0,
  };
}

function posOf(item: MoodItem, rank: number) {
  if (item.x === null || item.y === null || item.w === null) {
    return { ...autoPos(rank), rot: item.rot };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot };
}

const isUnplaced = (i: MoodItem) => i.x === null || i.y === null || i.w === null;

export function PortalMoodBoard({ board }: { board: MoodBoardData }) {
  // Stacking order: z (sort_order) — the last card the owner brought forward
  // stays on top. Auto-grid rank counts unplaced items in that same order.
  const ordered = [...board.items].sort((a, b) => a.z - b.z || a.id - b.id);
  const autoRank = new Map<number, number>();
  ordered.filter(isUnplaced).forEach((item, i) => autoRank.set(item.id, i));

  return (
    <div
      className="relative isolate aspect-[16/10] w-full select-none overflow-hidden rounded-lg border border-rule"
      style={{
        backgroundColor: board.bgColor || "var(--color-paper-2)",
        backgroundImage: board.bgColor
          ? undefined
          : "radial-gradient(circle, var(--color-rule) 1px, transparent 1px)",
        backgroundSize: board.bgColor ? undefined : "22px 22px",
      }}
    >
      {ordered.map((item, i) => {
        const pos = posOf(item, autoRank.get(item.id) ?? 0);
        const caption = item.label || item.note;
        const fixedH = pos.h !== null;
        const isText = item.kind === "text";
        const isSwatch = item.kind === "swatch";

        return (
          <div
            key={item.id}
            className={`absolute flex flex-col rounded-md border border-rule shadow-sm ${
              isText ? "bg-paper/95" : "bg-card"
            }`}
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${pos.w * 100}%`,
              height: fixedH ? `${(pos.h as number) * 100}%` : undefined,
              transform: pos.rot ? `rotate(${pos.rot}deg)` : undefined,
              zIndex: i + 1,
            }}
          >
            {isSwatch ? (
              <div
                className={`w-full rounded-t-md ${fixedH ? "min-h-0 flex-1" : "aspect-square"}`}
                style={{ background: item.swatch || "var(--color-paper-3)" }}
              />
            ) : isText ? (
              <div
                className={`flex items-center justify-center rounded-md px-2.5 py-2 text-center ${
                  fixedH ? "min-h-0 flex-1 overflow-hidden" : ""
                }`}
              >
                <span className="font-serif text-[13px] leading-snug text-ink">{item.label}</span>
              </div>
            ) : item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={caption || "Mood board item"}
                draggable={false}
                className={`w-full rounded-t-md object-cover ${fixedH ? "min-h-0 flex-1" : ""}`}
              />
            ) : (
              <div
                className={`flex items-center justify-center rounded-t-md bg-paper-3 px-2 text-center ${
                  fixedH ? "min-h-0 flex-1" : "aspect-[4/3]"
                }`}
              >
                <span className="line-clamp-3 text-[11px] leading-snug text-ink-2">
                  {caption || "No image"}
                </span>
              </div>
            )}

            {!isText && (caption || item.priceLabel) && (
              <div className="flex shrink-0 flex-col gap-0.5 border-t border-rule px-1.5 py-1">
                {caption && (
                  <span className="line-clamp-2 text-[10px] leading-snug text-ink-2">{caption}</span>
                )}
                {item.priceLabel && (
                  <span className="font-mono text-[9px] text-ink-3">{item.priceLabel}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
