// Client-safe names for the drawing-set builder (docs/floor-plan-designer-plan
// §8). The renderer itself is server-only in lib/plan-print.ts.

export type SheetKey =
  | "cover"
  | "existing"
  | "demo"
  | "new"
  | "cabinet"
  | "electrical"
  | "finish"
  | "elevations"
  | "sections"
  | "views"
  | "schedules"
  | "notes";

export const SHEET_KEYS: readonly SheetKey[] = [
  "cover", "existing", "demo", "new", "cabinet", "electrical", "finish", "elevations", "sections", "views", "schedules", "notes",
];

export const SHEET_LABELS: Record<SheetKey, string> = {
  cover: "Cover",
  existing: "Existing plan",
  demo: "Demo plan",
  new: "New construction plan",
  cabinet: "Cabinet plan",
  electrical: "Electrical / lighting plan",
  finish: "Finish plan",
  elevations: "Elevations",
  sections: "Sections",
  views: "3D views",
  schedules: "Schedules",
  notes: "Notes",
};

export const DEFAULT_SHEETS: readonly SheetKey[] = [
  "cover", "existing", "demo", "new", "cabinet", "electrical", "finish", "elevations", "views", "schedules",
];

export type PaperSize = "letter" | "tabloid" | "arch-d";
export type Orientation = "portrait" | "landscape";

export const PAPER_LABELS: Record<PaperSize, string> = {
  letter: 'Letter · 8½×11"',
  tabloid: 'Tabloid · 11×17"',
  "arch-d": 'Arch D · 24×36"',
};

/** Paper in PDF points (72/in). */
export const PAPER_PT: Record<PaperSize, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  tabloid: { w: 792, h: 1224 },
  "arch-d": { w: 1728, h: 2592 },
};

export interface SheetRequest {
  versionId: number | null;
  sheets: SheetKey[];
  paper: PaperSize;
  orientation: Orientation;
  captureFileIds: string[];
  notes: string;
}
