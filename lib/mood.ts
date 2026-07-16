// Mood board creator (P1-B3). DB-backed reads of project_mood for the project
// Mood tab — one free-form canvas per room, holding two kinds of pin: an
// uploaded reference image, or an item pinned from the catalog. Owner-only;
// images stream through the owner-only /api/files route. Writes live in
// lib/actions/mood.ts.
//
// Catalog pins are SNAPSHOTS: label/price_label/image_file_id are copied onto
// the row at pin time, so a board keeps rendering after the catalog item is
// edited or deleted (a mood board is a presentation frozen at curation time,
// not a live query). catalog_id is provenance only — it survives as the link
// back to the product page, and goes NULL if the item is deleted.

import { query } from "./db";

/** `project_mood.id` / `catalog_id` are bigserial, and node-postgres returns
 *  int8 as a STRING. Coerce on the way out so a `number` id really is one —
 *  the canvas sorts and compares these, and the write actions validate them.
 *  Ids are well under 2^53, so this is lossless. */
const toId = (v: string | number): number => Number(v);

/** Catalog `source_url` is free text (the browser-clip endpoint only trims and
 *  truncates it), and it lands in an href. Pass through http(s) only so a
 *  `javascript:` URL can never become a clickable link on a board. */
function safeUrl(raw: string | null): string {
  const url = (raw ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

export interface MoodItem {
  id: number;
  note: string;
  /** Snapshot catalog name at pin time; "" for a plain upload. */
  label: string;
  /** Snapshot display price, e.g. "$185 / sq ft". Free text — never summed. */
  priceLabel: string;
  /** /api/files/<id>, or null when the pin has no image (renders as a text card). */
  imageUrl: string | null;
  /** Source catalog item, or null for uploads / deleted items. */
  catalogId: number | null;
  /** Live product-page URL from the linked catalog item; "" when unlinked. */
  sourceUrl: string;
  /** Normalized layout: x/w are fractions of board width, y of board height.
   *  null = never placed — the canvas auto-lays it out. */
  x: number | null;
  y: number | null;
  w: number | null;
  /** Stacking order (sort_order): the last pin dragged sits on top. */
  z: number;
}

export interface MoodBoardData {
  room: string;
  items: MoodItem[];
}

interface MoodRow {
  id: number;
  room: string;
  note: string;
  label: string;
  price_label: string;
  image_file_id: string | null;
  catalog_id: number | null;
  source_url: string | null;
  pos_x: number | null;
  pos_y: number | null;
  pos_w: number | null;
  sort_order: number;
}

/** A project's mood boards, one per room (rooms sorted alphabetically). */
export async function getProjectMood(slug: string): Promise<MoodBoardData[]> {
  const { rows } = await query<MoodRow>(
    `SELECT m.id, m.room, m.note, m.label, m.price_label, m.image_file_id,
            m.catalog_id, c.source_url, m.pos_x, m.pos_y, m.pos_w, m.sort_order
       FROM project_mood m
       JOIN projects p ON p.id = m.project_id
       LEFT JOIN catalog_items c ON c.id = m.catalog_id
      WHERE p.slug = $1
      ORDER BY m.room, m.sort_order, m.id`,
    [slug],
  );

  const byRoom = new Map<string, MoodBoardData>();
  for (const r of rows) {
    let board = byRoom.get(r.room);
    if (!board) {
      board = { room: r.room, items: [] };
      byRoom.set(r.room, board);
    }
    board.items.push({
      id: toId(r.id),
      note: r.note,
      label: r.label,
      priceLabel: r.price_label,
      imageUrl: r.image_file_id ? `/api/files/${r.image_file_id}` : null,
      catalogId: r.catalog_id === null ? null : toId(r.catalog_id),
      sourceUrl: safeUrl(r.source_url),
      x: r.pos_x,
      y: r.pos_y,
      w: r.pos_w,
      z: r.sort_order,
    });
  }
  return [...byRoom.values()];
}
