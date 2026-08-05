"use client";

import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import { PANEL_DEFAULTS, readPanelState, subscribePanelState, writePanelState } from "./panelStore";
import { PanelQueueProvider } from "./PanelQueueProvider";

export interface PanelLayout {
  width: number;
  collapsed: boolean;
  where: "docked" | "window";
  /** False until the first client effect adopts the persisted state — the
   *  server render uses defaults (hydration safety, see panelStore). */
  ready: boolean;
}

interface PanelContextValue {
  layout: PanelLayout;
  /** Live during a splitter drag — visual only, not persisted. */
  setWidth: (w: number) => void;
  /** Drag end / double-click reset — persists and syncs other windows. */
  commitWidth: (w: number) => void;
  toggleCollapsed: () => void;
  /** Dock ↔ popout transitions. Updates this window's state AND persists —
   *  panelStore's own writes don't echo back to the writing window. */
  setWhere: (where: "docked" | "window") => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

/** Client root for everything panel: layout prefs (persisted via panelStore,
 *  synced across windows) and the dock's self-hydrating queue data. Mounted
 *  once in the (os) layout, so it survives all soft navigation. */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<PanelLayout>({
    width: PANEL_DEFAULTS.width,
    collapsed: PANEL_DEFAULTS.collapsed,
    where: PANEL_DEFAULTS.where,
    ready: false,
  });

  useEffect(() => {
    const adopt = () => {
      const st = readPanelState();
      startTransition(() =>
        setLayout({ width: st.width, collapsed: st.collapsed, where: st.where, ready: true }),
      );
    };
    adopt();
    return subscribePanelState(adopt);
  }, []);

  const setWidth = (w: number) => setLayout((l) => ({ ...l, width: w }));
  const commitWidth = (w: number) => {
    setLayout((l) => ({ ...l, width: w }));
    writePanelState({ width: w });
  };
  const toggleCollapsed = () =>
    setLayout((l) => {
      writePanelState({ collapsed: !l.collapsed });
      return { ...l, collapsed: !l.collapsed };
    });
  const setWhere = (where: "docked" | "window") => {
    writePanelState({ where });
    setLayout((l) => ({ ...l, where }));
  };

  return (
    <PanelContext.Provider value={{ layout, setWidth, commitWidth, toggleCollapsed, setWhere }}>
      <PanelQueueProvider>{children}</PanelQueueProvider>
    </PanelContext.Provider>
  );
}

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("usePanel must be used within PanelProvider");
  return ctx;
}
