"use client";

import { useEffect, useState } from "react";
import { subscribePanelBus } from "./panelBus";
import { WorkbenchPanel } from "./WorkbenchPanel";

/** /workbench's client wrapper: the workbench polls fast (3s) while a run is
 *  live and lazily (30s) otherwise — run lifecycle arrives over the panel bus
 *  from whichever window hosts the chat. */
export function WorkbenchLive({ subjectId }: { subjectId: string }) {
  const [runActive, setRunActive] = useState(false);

  useEffect(
    () =>
      subscribePanelBus((m) => {
        if (m.type === "run") setRunActive(m.phase === "start");
      }),
    [],
  );

  return <WorkbenchPanel subjectId={subjectId} runActive={runActive} />;
}
