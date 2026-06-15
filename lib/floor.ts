// Floor-plan data builder. Structural shell only — the full editor internals
// (live geometry, drag, snapping) are deferred. Mock-backed; reached from a
// Floor-plan tab inside a Lead or Project, not the global sidebar.

export interface FloorTool {
  /** Tool name, e.g. "Select" / "Wall". */
  label: string;
  /** Keyboard hotkey. */
  key: string;
  /** lucide icon key, mapped in the page. */
  icon: string;
}

export interface FloorData {
  title: string;
  tools: FloorTool[];
  selected: {
    name: string;
    type: string;
    fields: { label: string; value: string }[];
  };
  catalogLabel: string;
}

const TOOLS: FloorTool[] = [
  { label: "Select", key: "S", icon: "select" },
  { label: "Wall", key: "W", icon: "wall" },
  { label: "Door", key: "D", icon: "door" },
  { label: "Window", key: "N", icon: "window" },
  { label: "Measure", key: "M", icon: "measure" },
  { label: "Cabinet", key: "C", icon: "cabinet" },
  { label: "Appliance", key: "A", icon: "appliance" },
  { label: "Plumbing", key: "P", icon: "plumb" },
  { label: "Electrical", key: "E", icon: "elec" },
  { label: "Note", key: "T", icon: "note" },
];

export async function getFloorData(): Promise<FloorData> {
  return {
    title: "Henderson kitchen",
    tools: TOOLS,
    selected: {
      name: "Island",
      type: "cabinet run · 4 base · waterfall",
      fields: [
        { label: "Width", value: "8' 0\"" },
        { label: "Depth", value: "2' 8\"" },
        { label: "Height", value: "36\"" },
        { label: "Cabinet box", value: "Shaker maple · Sand" },
        { label: "Counter", value: "Calacatta marble · waterfall" },
        { label: "Pulls", value: "Brass bar · 4 in" },
      ],
    },
    catalogLabel: "Catalog · island bases",
  };
}
