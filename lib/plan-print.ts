import "server-only";

// Drawing-set renderer for the floor-plan designer (docs/floor-plan-designer-
// plan.md §8). The renderer itself is pure pdfkit and lives in
// lib/plan-print-core.ts (no server-only marker, so tests can run it under
// plain Node); this module is the server-only face app code imports.

export {
  fitScale,
  drawOpsToPdf,
  renderPlanSheetsCore as renderPlanSheets,
  type PrintCapture,
  type PrintInput,
} from "./plan-print-core";
