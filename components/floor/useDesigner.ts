"use client";

// Designer state: the live PlanDoc, an undo/redo stack of docs labelled by
// the op that produced them, selection, the active tool, and a debounced
// autosave with optimistic-rev conflict handling. Every edit goes through
// apply(op) → lib/plan-ops so the canvas, inspector, and agents share one
// edit language.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { migrateDoc, type DesignerDefaults, type PlanDoc } from "@/lib/plan-doc";
import { applyOp, applyOps, opLabel, PlanOpError, type PlanOp } from "@/lib/plan-ops";
import { savePlanDesign } from "@/lib/actions/plan-designs";
import { toastError } from "@/components/ui/Toast";

export type ToolId =
  | "select" | "pan"
  | "wall" | "room" | "door" | "window" | "opening" | "stairs" | "column" | "beam" | "soffit"
  | "base" | "wallcab" | "tall" | "island" | "filler" | "counter"
  | "appliance" | "plumbing" | "electrical" | "hvac" | "furniture"
  | "floorFinish" | "wallFinish" | "trim"
  | "measure" | "dimension" | "note" | "comment" | "photo"
  | "camera" | "section";

export type SaveState =
  | { kind: "saved"; at: number }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline"; queued: number }
  | { kind: "conflict"; rev: number; doc: PlanDoc }
  | { kind: "error"; message: string };

interface HistoryEntry {
  doc: PlanDoc;
  label: string;
}

const MAX_HISTORY = 60;
const AUTOSAVE_MS = 1500;

export interface DesignerState {
  doc: PlanDoc;
  rev: number;
  levelId: string;
  setLevelId: (id: string) => void;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  selected: string[];
  select: (ids: string[] | ((prev: string[]) => string[])) => void;
  hover: string | null;
  setHover: (id: string | null) => void;
  apply: (op: PlanOp | PlanOp[], opts?: { label?: string; transient?: boolean }) => boolean;
  /** Preview a change without a history entry (drag in progress); commit with apply(). */
  preview: (op: PlanOp | PlanOp[]) => void;
  cancelPreview: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  history: { label: string; index: number }[];
  jumpTo: (index: number) => void;
  save: SaveState;
  saveNow: () => Promise<void>;
  reloadFromConflict: () => void;
  keepMineOverConflict: () => void;
  defaults: DesignerDefaults;
}

export function useDesigner(designId: number, initialDoc: PlanDoc, initialRev: number, readOnly = false): DesignerState {
  const [doc, setDocState] = useState<PlanDoc>(initialDoc);
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [labels, setLabels] = useState<string[]>(["Opened"]);
  const [levelIdRaw, setLevelId] = useState(initialDoc.levels[0]?.id ?? "L1");
  const [tool, setTool] = useState<ToolId>("select");
  const [selectedRaw, setSelected] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: 0 });
  const [rev, setRev] = useState(initialRev);

  const revRef = useRef(initialRev);
  const docRef = useRef(initialDoc);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const previewBase = useRef<PlanDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDoc = useCallback((next: PlanDoc) => {
    docRef.current = next;
    setDocState(next);
  }, []);

  // Selection hygiene: ids that no longer exist fall out of the selection.
  const selected = useMemo(() => {
    if (!selectedRaw.length) return selectedRaw;
    const ids = new Set<string>();
    for (const w of doc.walls) ids.add(w.id);
    for (const o of doc.openings) ids.add(o.id);
    for (const i of doc.items) ids.add(i.id);
    for (const e of doc.electrical) ids.add(e.id);
    for (const n of doc.notes) ids.add(n.id);
    for (const d of doc.dims) ids.add(d.id);
    for (const c of doc.counters) ids.add(c.id);
    for (const s of doc.stairs) ids.add(s.id);
    for (const s of doc.structure) ids.add(s.id);
    for (const r of doc.rooms) ids.add(r.id);
    for (const c of doc.cameras) ids.add(c.id);
    for (const s of doc.sections) ids.add(s.id);
    for (const p of doc.photos) ids.add(p.id);
    for (const f of doc.finishes) ids.add(f.id);
    const kept = selectedRaw.filter((id) => ids.has(id));
    return kept.length === selectedRaw.length ? selectedRaw : kept;
  }, [doc, selectedRaw]);

  // The level stays valid if levels change.
  const levelId = useMemo(
    () => (doc.levels.some((l) => l.id === levelIdRaw) ? levelIdRaw : doc.levels[0]?.id ?? "L1"),
    [doc.levels, levelIdRaw],
  );

  const doSave = useCallback(async () => {
    if (readOnly || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setSave({ kind: "saving" });
    const snapshot = docRef.current;
    try {
      const r = await savePlanDesign(designId, snapshot, revRef.current);
      if (r.ok) {
        revRef.current = r.rev;
        setRev(r.rev);
        setSave(dirtyRef.current ? { kind: "dirty" } : { kind: "saved", at: Date.now() });
      } else if (r.conflict) {
        dirtyRef.current = true;
        setSave({ kind: "conflict", rev: r.conflict.rev, doc: migrateDoc(r.conflict.doc) });
      } else {
        dirtyRef.current = true;
        setSave({ kind: "error", message: r.error });
      }
    } catch (e) {
      dirtyRef.current = true;
      setSave({ kind: "offline", queued: 1 });
      void e;
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && !timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
          void doSave();
        }, AUTOSAVE_MS * 3);
      }
    }
  }, [designId, readOnly]);

  const scheduleSave = useCallback(() => {
    if (readOnly) return;
    dirtyRef.current = true;
    setSave((s) => (s.kind === "conflict" ? s : { kind: "dirty" }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void doSave();
    }, AUTOSAVE_MS);
  }, [doSave, readOnly]);

  // Flush on unload.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (timer.current) clearTimeout(timer.current);
      if (dirtyRef.current) void doSave();
    };
  }, [doSave]);

  const commit = useCallback(
    (next: PlanDoc, label: string) => {
      const base = previewBase.current ?? docRef.current;
      previewBase.current = null;
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), { doc: base, label }]);
      setFuture([]);
      setLabels((l) => [...l.slice(-(MAX_HISTORY - 1)), label]);
      setDoc(next);
      scheduleSave();
    },
    [scheduleSave, setDoc],
  );

  const apply = useCallback(
    (op: PlanOp | PlanOp[], opts?: { label?: string; transient?: boolean }): boolean => {
      if (readOnly) return false;
      const ops = Array.isArray(op) ? op : [op];
      if (!ops.length) return false;
      const base = previewBase.current ?? docRef.current;
      try {
        const next = applyOps(base, ops);
        const label = opts?.label ?? opLabel(ops[ops.length - 1]);
        if (opts?.transient) {
          previewBase.current = null;
          setDoc(next);
          scheduleSave();
        } else commit(next, label);
        return true;
      } catch (e) {
        previewBase.current = null;
        setDoc(base);
        toastError(e instanceof PlanOpError ? e.message : "That edit didn't apply.");
        return false;
      }
    },
    [commit, readOnly, scheduleSave, setDoc],
  );

  const preview = useCallback(
    (op: PlanOp | PlanOp[]) => {
      if (readOnly) return;
      const ops = Array.isArray(op) ? op : [op];
      if (!previewBase.current) previewBase.current = docRef.current;
      try {
        let next = previewBase.current;
        for (const o of ops) next = applyOp(next, o);
        setDoc(next);
      } catch {
        /* keep the last good preview */
      }
    },
    [readOnly, setDoc],
  );

  const cancelPreview = useCallback(() => {
    if (previewBase.current) {
      setDoc(previewBase.current);
      previewBase.current = null;
    }
  }, [setDoc]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const entry = p[p.length - 1];
      setFuture((f) => [{ doc: docRef.current, label: entry.label }, ...f]);
      setLabels((l) => l.slice(0, -1));
      setDoc(entry.doc);
      scheduleSave();
      return p.slice(0, -1);
    });
  }, [scheduleSave, setDoc]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const entry = f[0];
      setPast((p) => [...p, { doc: docRef.current, label: entry.label }]);
      setLabels((l) => [...l, entry.label]);
      setDoc(entry.doc);
      scheduleSave();
      return f.slice(1);
    });
  }, [scheduleSave, setDoc]);

  const jumpTo = useCallback(
    (index: number) => {
      // index into labels: 0 = "Opened". Undo (labels.length-1-index) times.
      const steps = labels.length - 1 - index;
      for (let i = 0; i < steps; i++) undo();
    },
    [labels.length, undo],
  );

  const reloadFromConflict = useCallback(() => {
    if (save.kind !== "conflict") return;
    revRef.current = save.rev;
    setRev(save.rev);
    dirtyRef.current = false;
    setPast([]);
    setFuture([]);
    setLabels(["Reloaded"]);
    setDoc(save.doc);
    setSave({ kind: "saved", at: Date.now() });
  }, [save, setDoc]);

  const keepMineOverConflict = useCallback(() => {
    if (save.kind !== "conflict") return;
    revRef.current = save.rev;
    setRev(save.rev);
    dirtyRef.current = true;
    setSave({ kind: "dirty" });
    void doSave();
  }, [doSave, save]);

  const history = useMemo(() => labels.map((label, index) => ({ label, index })), [labels]);

  return {
    doc,
    rev,
    levelId,
    setLevelId,
    tool,
    setTool,
    selected,
    select: (ids) => setSelected((prev) => (typeof ids === "function" ? ids(prev) : ids)),
    hover,
    setHover,
    apply,
    preview,
    cancelPreview,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    history,
    jumpTo,
    save,
    saveNow: doSave,
    reloadFromConflict,
    keepMineOverConflict,
    defaults: doc.settings.defaults,
  };
}
