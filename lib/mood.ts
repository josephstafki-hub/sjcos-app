// Mood board builder (Review-round-3 S5D). DB-backed reads of project_mood for
// the project Mood tab — per-room reference-image collections. Owner-only;
// images stream through the owner-only /api/files route. Writes live in
// lib/actions/mood.ts.

import { query } from "./db";

export interface MoodImage {
  id: number;
  note: string;
  imageUrl: string;
}

export interface MoodRoom {
  room: string;
  images: MoodImage[];
}

interface MoodRow {
  id: number;
  room: string;
  note: string;
  image_file_id: string;
}

/** A project's mood images grouped by room (room order = first appearance). */
export async function getProjectMood(slug: string): Promise<MoodRoom[]> {
  const { rows } = await query<MoodRow>(
    `SELECT m.id, m.room, m.note, m.image_file_id
       FROM project_mood m
       JOIN projects p ON p.id = m.project_id
      WHERE p.slug = $1
      ORDER BY m.room, m.sort_order, m.id`,
    [slug],
  );

  const byRoom = new Map<string, MoodRoom>();
  for (const r of rows) {
    let group = byRoom.get(r.room);
    if (!group) {
      group = { room: r.room, images: [] };
      byRoom.set(r.room, group);
    }
    group.images.push({ id: r.id, note: r.note, imageUrl: `/api/files/${r.image_file_id}` });
  }
  return [...byRoom.values()];
}
