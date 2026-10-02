"use client";

// Designer activity → owner office time (A19 / A21 contract, lib/designer-
// contract.ts DesignerActivityEvent). Emits focus / heartbeat / idle / blur /
// end for this design + a per-mount session id; the SERVER resolves the
// project from the design and materialises bounded intervals (idle gaps
// become review items). Only real interaction (pointer, keys, wheel) counts
// as activity; an open tab, background rendering or a locked screen does not.

import { useEffect, useRef } from "react";

const HEARTBEAT_MS = 60_000;
const IDLE_MS = 5 * 60_000;

export function ActivityEmitter({ designId, enabled }: { designId: number; enabled: boolean }) {
  const state = useRef({ sessionId: "", seq: 0, lastActivity: 0, active: false, idle: false, stopped: false });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const s = state.current;
    s.sessionId = crypto.randomUUID();
    s.seq = 0;
    s.stopped = false;
    const deviceId = (() => {
      try {
        const k = "sjc_device_id";
        let v = localStorage.getItem(k);
        if (!v) {
          v = crypto.randomUUID();
          localStorage.setItem(k, v);
        }
        return v;
      } catch {
        return "web";
      }
    })();
    const post = (kind: "focus" | "heartbeat" | "blur" | "idle" | "end", beacon = false) => {
      if (s.stopped && kind !== "end") return;
      const body = JSON.stringify({ designer: [{ designId, sessionId: s.sessionId, seq: ++s.seq, kind, at: new Date().toISOString(), deviceId }] });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/time/events", new Blob([body], { type: "application/json" }));
        return;
      }
      fetch("/api/time/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true })
        .then((r) => {
          if (r.status === 403) s.stopped = true; // not the owner: stop quietly
        })
        .catch(() => {});
    };
    const onActivity = () => {
      const now = Date.now();
      s.lastActivity = now;
      if (!s.active || s.idle) {
        s.active = true;
        s.idle = false;
        if (document.visibilityState === "visible") post("focus");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (s.active) post("blur");
        s.active = false;
      }
    };
    const tick = () => {
      if (!s.active || document.visibilityState !== "visible") return;
      if (Date.now() - s.lastActivity > IDLE_MS) {
        if (!s.idle) {
          s.idle = true;
          post("idle");
        }
        return;
      }
      post("heartbeat");
    };
    const onUnload = () => post("end", true);
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onUnload);
    const timer = window.setInterval(tick, HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onUnload);
      if (s.active) post("end", true);
      s.stopped = true;
    };
  }, [designId, enabled]);

  return null;
}
