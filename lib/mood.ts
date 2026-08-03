// Mood board creator (P1-B3). DB-backed reads of project_mood for the project
// Mood tab — one free-form canvas per room, holding three kinds of item: an
// uploaded reference image, an item pinned from the catalog, a standalone text
// block, or a colour swatch. Owner-only; images stream through the owner-only
// /api/files route. Writes live in lib/actions/mood.ts.
//
// Catalog pins are SNAPSHOTS: label/price_label/image_file_id are copied onto
// the row at pin time, so a board keeps rendering after the catalog item is
// edited or deleted (a mood board is a presentation frozen at curation time,
// not a live query). catalog_id is provenance only — it survives as the link
// back to the product page, and goes NULL if the item is deleted.
//
// Rooms come from project_mood_boards, NOT from the distinct rooms in
// project_mood — a board has to be able to exist while it is still empty.
// Rooms that only exist as pin rows (pinned before the settings table landed,
// or by a path that skipped it) are unioned in so no board can go missing.

import { query } from "./db";

/** `project_mood.id` / `catalog_id` are bigserial, and node-postgres returns
 *  int8 as a STRING. Coerce on the way out so a `number` id really is one —
 *  the canvas sorts and compares these, and the write actions validate them.
 *  Ids are well under 2^53, so this is lossless. */
const toId = (v: string | number): number => Number(v);

/** `real` columns come back as numbers, but go through the same coercion as ids
 *  so a driver change can't silently hand the canvas a string to do maths on. */
const toNum = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Catalog `source_url` is free text (the browser-clip endpoint only trims and
 *  truncates it), and it lands in an href. Pass through http(s) only so a
 *  `javascript:` URL can never become a clickable link on a board. */
function safeUrl(raw: string | null): string {
  const url = (raw ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

/** Swatch/background colours land in a `style` attribute, so only a literal
 *  hex triple is allowed through — never arbitrary CSS. */
export function safeColor(raw: string | null): string {
  const c = (raw ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "";
}

export type MoodKind = "pin" | "text" | "swatch";

export interface MoodItem {
  id: number;
  /** 'pin' = image/catalog card, 'text' = caption block, 'swatch' = colour chip. */
  kind: MoodKind;
  note: string;
  /** Snapshot catalog name at pin time; the words themselves for a text block;
   *  "" for a plain upload. */
  label: string;
  /** Snapshot display price, e.g. "$185 / sq ft". Free text — never summed. */
  priceLabel: string;
  /** '#rrggbb' for a swatch, "" otherwise. */
  swatch: string;
  /** /api/files/<id>, or null when the pin has no image (renders as a text card). */
  imageUrl: string | null;
  /** Source catalog item, or null for uploads / deleted items. */
  catalogId: number | null;
  /** Live product-page URL from the linked catalog item; "" when unlinked. */
  sourceUrl: string;
  /** Normalized layout: x/w are fractions of board width, y/h of board height.
   *  null x/y/w = never placed — the canvas auto-lays it out. null h = auto,
   *  the card is as tall as its content makes it. */
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  /** Rotation in degrees about the card's centre. */
  rot: number;
  /** Stacking order (sort_order): the last pin dragged sits on top. */
  z: number;
}

export interface MoodBoardData {
  room: string;
  /** Display title shown above the canvas; falls back to the room name. */
  title: string;
  /** '#rrggbb' board background, or "" for the default dotted paper. */
  bgColor: string;
  items: MoodItem[];
}

interface MoodRow {
  id: number;
  room: string;
  kind: MoodKind;
  note: string;
  label: string;
  price_label: string;
  swatch: string;
  image_file_id: string | null;
  catalog_id: number | null;
  source_url: string | null;
  pos_x: number | null;
  pos_y: number | null;
  pos_w: number | null;
  pos_h: number | null;
  pos_rot: number | null;
  sort_order: number;
}

interface BoardRow {
  room: string;
  title: string;
  bg_color: string;
}

/** A project's mood boards, one per room (rooms sorted alphabetically). */
export async function getProjectMood(slug: string): Promise<MoodBoardData[]> {
  const [{ rows: boardRows }, { rows }] = await Promise.all([
    query<BoardRow>(
      `SELECT b.room, b.title, b.bg_color
         FROM project_mood_boards b
         JOIN projects p ON p.id = b.project_id
        WHERE p.slug = $1
        ORDER BY b.room`,
      [slug],
    ),
    query<MoodRow>(
      `SELECT m.id, m.room, m.kind, m.note, m.label, m.price_label, m.swatch,
              m.image_file_id, m.catalog_id, c.source_url,
              m.pos_x, m.pos_y, m.pos_w, m.pos_h, m.pos_rot, m.sort_order
         FROM project_mood m
         JOIN projects p ON p.id = m.project_id
         LEFT JOIN catalog_items c ON c.id = m.catalog_id
        WHERE p.slug = $1
        ORDER BY m.room, m.sort_order, m.id`,
      [slug],
    ),
  ]);

  const byRoom = new Map<string, MoodBoardData>();
  for (const b of boardRows) {
    byRoom.set(b.room, { room: b.room, title: b.title, bgColor: safeColor(b.bg_color), items: [] });
  }

  for (const r of rows) {
    let board = byRoom.get(r.room);
    if (!board) {
      // A room with pins but no settings row — keep the board rather than
      // dropping every pin in it on the floor.
      board = { room: r.room, title: "", bgColor: "", items: [] };
      byRoom.set(r.room, board);
    }
    board.items.push({
      id: toId(r.id),
      kind: r.kind ?? "pin",
      note: r.note,
      label: r.label,
      priceLabel: r.price_label,
      swatch: safeColor(r.swatch),
      imageUrl: r.image_file_id ? `/api/files/${r.image_file_id}` : null,
      catalogId: r.catalog_id === null ? null : toId(r.catalog_id),
      sourceUrl: safeUrl(r.source_url),
      x: toNum(r.pos_x),
      y: toNum(r.pos_y),
      w: toNum(r.pos_w),
      h: toNum(r.pos_h),
      rot: toNum(r.pos_rot) ?? 0,
      z: r.sort_order,
    });
  }

  return [...byRoom.values()].sort((a, b) => a.room.localeCompare(b.room));
}
