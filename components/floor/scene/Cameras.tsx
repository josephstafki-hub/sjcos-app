"use client";

// Camera rig: perspective (orbit / walk) or top-down orthographic (plan),
// fly-to animation, fit-to-bounds, and a custom first-person walk (WASD /
// arrows + pointer-drag look, eye at 66", wall collision). No pointer lock,
// so it works on iPad.

import { useCallback, useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Camera as PlanCamera, Wall } from "@/lib/plan-doc";
import { distToWall } from "@/lib/plan-geometry";
import { boundsCentre, boundsExtent, type SceneApi, type WorldBounds } from "./api";

export type CameraMode = "orbit" | "walk" | "plan";

interface Anim {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  t0: THREE.Vector3;
  t1: THREE.Vector3;
  start: number;
  dur: number;
}

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

interface RigProps {
  mode: CameraMode;
  apiRef: RefObject<SceneApi>;
  bounds: WorldBounds;
  /** Walls the walk camera collides with. */
  walls: Wall[];
  /** Floor height the walk eye is measured from. */
  floorY: number;
  onCameraChange?: (pos: [number, number, number], target: [number, number, number]) => void;
}

const smooth = (k: number) => k * k * (3 - 2 * k);

export function CameraRig({ mode, apiRef, bounds, walls, floorY, onCameraChange }: RigProps) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const targetRef = useRef(new THREE.Vector3());
  const animRef = useRef<Anim | null>(null);
  const syncRef = useRef(false);
  const eyeRef = useRef(66);
  const lastEmit = useRef(0);
  const lastPos = useRef(new THREE.Vector3(NaN, NaN, NaN));
  const initRef = useRef<string | null>(null);
  const [cx, cy, cz] = boundsCentre(bounds);
  const [ex, ey, ez] = boundsExtent(bounds);

  const controls = useCallback((): ControlsLike | null => {
    const c = get().controls as unknown as Partial<ControlsLike> | null;
    return c && c.target instanceof THREE.Vector3 && typeof c.update === "function" ? (c as ControlsLike) : null;
  }, [get]);

  const emit = useCallback(
    (force = false) => {
      if (!onCameraChange) return;
      const now = performance.now();
      if (!force && now - lastEmit.current < 250) return;
      const cam = get().camera;
      if (!force && lastPos.current.distanceToSquared(cam.position) < 0.01) return;
      lastEmit.current = now;
      lastPos.current.copy(cam.position);
      const t = targetRef.current;
      onCameraChange([cam.position.x, cam.position.y, cam.position.z], [t.x, t.y, t.z]);
    },
    [get, onCameraChange],
  );

  const applyView = useCallback(
    (pos: THREE.Vector3, target: THREE.Vector3) => {
      const cam = get().camera;
      cam.position.copy(pos);
      targetRef.current.copy(target);
      const c = controls();
      if (c) {
        c.target.copy(target);
        c.update();
      } else {
        cam.lookAt(target);
      }
      syncRef.current = true;
      invalidate();
    },
    [get, controls, invalidate],
  );

  const startAnim = useCallback(
    (pos: THREE.Vector3, target: THREE.Vector3, dur: number) => {
      if (dur <= 0) {
        applyView(pos, target);
        return;
      }
      const cam = get().camera;
      animRef.current = {
        p0: cam.position.clone(),
        p1: pos.clone(),
        t0: targetRef.current.clone(),
        t1: target.clone(),
        start: performance.now(),
        dur,
      };
      invalidate();
    },
    [applyView, get, invalidate],
  );

  const fit = useCallback(
    (dur = 600) => {
      const cam = get().camera;
      const centre = new THREE.Vector3(cx, cy, cz);
      if (cam instanceof THREE.OrthographicCamera) {
        const zx = size.width / Math.max(1, ex * 1.2);
        const zz = size.height / Math.max(1, ez * 1.2);
        cam.zoom = Math.max(0.05, Math.min(zx, zz));
        cam.updateProjectionMatrix();
        startAnim(new THREE.Vector3(cx, cy + 2000, cz), centre, dur);
        return;
      }
      const fov = cam instanceof THREE.PerspectiveCamera ? cam.fov : 50;
      const r = Math.max(30, 0.5 * Math.hypot(ex, ey, ez));
      const d = (r / Math.sin((fov * Math.PI) / 360)) * 1.05;
      const dir = new THREE.Vector3(0.75, 0.6, 1).normalize();
      startAnim(centre.clone().addScaledVector(dir, d), centre, dur);
    },
    [get, cx, cy, cz, ex, ey, ez, size.width, size.height, startAnim],
  );

  const flyTo = useCallback(
    (pc: PlanCamera, dur = 600) => {
      const cam = get().camera;
      if (cam instanceof THREE.PerspectiveCamera && pc.fov && Math.abs(cam.fov - pc.fov) > 0.5) {
        cam.fov = pc.fov;
        cam.updateProjectionMatrix();
      }
      startAnim(new THREE.Vector3(...pc.pos), new THREE.Vector3(...pc.target), dur);
    },
    [get, startAnim],
  );

  const setWalkEye = useCallback(
    (h: number) => {
      eyeRef.current = Math.max(12, Math.min(120, h));
      if (mode === "walk") {
        const cam = get().camera;
        cam.position.y = floorY + eyeRef.current;
        invalidate();
      }
    },
    [mode, get, floorY, invalidate],
  );

  useEffect(() => {
    const a = apiRef.current;
    a.flyTo = flyTo;
    a.fit = fit;
    a.setWalkEye = setWalkEye;
    return () => {
      a.flyTo = null;
      a.fit = null;
      a.setWalkEye = null;
    };
  }, [apiRef, flyTo, fit, setWalkEye]);

  // First frame, mode changes, and the first time bounds / a real viewport
  // size show up: frame it. Deliberately NOT on every bounds change, so doc
  // edits never snap the camera.
  const hasBounds = ex > 0 || ez > 0;
  const hasSize = size.width > 0 && size.height > 0;
  useEffect(() => {
    const key = `${mode === "plan" ? "plan" : "persp"}:${hasBounds ? 1 : 0}:${hasSize ? 1 : 0}`;
    if (initRef.current === key) return;
    initRef.current = key;
    fit(0);
    if (mode === "walk") {
      const cam = get().camera;
      cam.position.y = floorY + eyeRef.current;
      targetRef.current.set(cx, floorY + eyeRef.current, cz);
      cam.lookAt(targetRef.current);
      syncRef.current = true;
      invalidate();
    }
    // Only re-run on mode / bounds- / size-availability change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hasBounds, hasSize]);

  useFrame(() => {
    const a = animRef.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.start) / a.dur);
      const s = smooth(k);
      const cam = get().camera;
      cam.position.lerpVectors(a.p0, a.p1, s);
      targetRef.current.lerpVectors(a.t0, a.t1, s);
      const c = controls();
      if (c) {
        c.target.copy(targetRef.current);
        c.update();
      } else {
        cam.lookAt(targetRef.current);
      }
      if (k >= 1) {
        animRef.current = null;
        syncRef.current = true;
        emit(true);
      } else {
        emit();
      }
      invalidate();
    } else {
      emit();
    }
  });

  const onControlsChange = useCallback(() => {
    const c = controls();
    if (c) targetRef.current.copy(c.target);
    emit();
  }, [controls, emit]);

  return (
    <>
      {/* No position/target props here: they would be re-applied whenever the
          bounds change and snap the camera. The init effect above frames the
          scene once; after that the rig owns position + target. */}
      {mode === "plan" ? (
        <OrthographicCamera makeDefault up={[0, 0, -1]} near={-10000} far={10000} />
      ) : (
        <PerspectiveCamera makeDefault fov={50} near={2} far={60000} />
      )}
      {mode === "orbit" && (
        <OrbitControls
          makeDefault
          enableDamping={false}
          maxPolarAngle={Math.PI * 0.49}
          minDistance={12}
          maxDistance={20000}
          onChange={onControlsChange}
        />
      )}
      {mode === "plan" && (
        <OrbitControls
          makeDefault
          enableRotate={false}
          enableDamping={false}
          screenSpacePanning
          minZoom={0.05}
          maxZoom={40}
          onChange={onControlsChange}
        />
      )}
      {mode === "walk" && (
        <WalkControls walls={walls} floorY={floorY} eyeRef={eyeRef} targetRef={targetRef} syncRef={syncRef} animRef={animRef} emit={emit} />
      )}
    </>
  );
}

// ─── Walk ────────────────────────────────────────────────────────────────────

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function WalkControls({
  walls,
  floorY,
  eyeRef,
  targetRef,
  syncRef,
  animRef,
  emit,
}: {
  walls: Wall[];
  floorY: number;
  eyeRef: RefObject<number>;
  targetRef: RefObject<THREE.Vector3>;
  syncRef: RefObject<boolean>;
  animRef: RefObject<Anim | null>;
  emit: (force?: boolean) => void;
}) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: 0, pitch: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const wheel = useRef(0);
  const wallsRef = useRef(walls);
  useEffect(() => {
    wallsRef.current = walls;
  }, [walls]);

  const syncFromCamera = useCallback(() => {
    const cam = get().camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    look.current.yaw = Math.atan2(-dir.x, -dir.z);
    look.current.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  }, [get]);

  const applyLook = useCallback(() => {
    const cam = get().camera;
    cam.rotation.order = "YXZ";
    cam.rotation.set(look.current.pitch, look.current.yaw, 0);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    targetRef.current.copy(cam.position).addScaledVector(fwd, 120);
  }, [get, targetRef]);

  useEffect(() => {
    syncFromCamera();
    applyLook();
    invalidate();
  }, [syncFromCamera, applyLook, invalidate]);

  useEffect(() => {
    const el = get().gl.domElement;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      look.current.yaw -= dx * 0.005;
      look.current.pitch = Math.max(-1.3, Math.min(1.3, look.current.pitch - dy * 0.005));
      applyLook();
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (drag.current?.id === e.pointerId) drag.current = null;
      el.releasePointerCapture?.(e.pointerId);
      emit(true);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheel.current += -e.deltaY * 0.15;
      invalidate();
    };
    const keyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (MOVE_KEYS[e.code] || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        keys.current.add(e.code);
        e.preventDefault();
        invalidate();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };
    const blur = () => keys.current.clear();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    el.style.touchAction = "none";
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, [get, applyLook, invalidate, emit]);

  const blocked = (x: number, z: number): boolean => {
    const p = { x, y: z };
    for (const w of wallsRef.current) if (distToWall(w, p) < 6 + w.thickIn / 2) return true;
    return false;
  };

  useFrame((_, dt) => {
    if (animRef.current) return; // rig is flying the camera
    if (syncRef.current) {
      syncRef.current = false;
      syncFromCamera();
      applyLook();
    }
    const cam = get().camera;
    let fx = 0;
    let fz = 0;
    for (const code of keys.current) {
      const v = MOVE_KEYS[code];
      if (v) {
        fx += v[0];
        fz += v[1];
      }
    }
    let ahead = fz;
    if (wheel.current !== 0) {
      ahead += wheel.current / Math.max(dt, 1 / 120) / 60;
      wheel.current = 0;
    }
    if (fx === 0 && ahead === 0) return;
    const fast = keys.current.has("ShiftLeft") || keys.current.has("ShiftRight");
    const speed = (fast ? 120 : 60) * Math.min(dt, 0.1);
    const yaw = look.current.yaw;
    const fwd = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
    const right = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
    const step = fwd.multiplyScalar(ahead * speed).add(right.multiplyScalar(fx * speed));
    const nx = cam.position.x + step.x;
    const nz = cam.position.z + step.y;
    if (!blocked(nx, nz)) {
      cam.position.x = nx;
      cam.position.z = nz;
    } else if (!blocked(nx, cam.position.z)) {
      cam.position.x = nx;
    } else if (!blocked(cam.position.x, nz)) {
      cam.position.z = nz;
    }
    cam.position.y = floorY + (eyeRef.current ?? 66);
    applyLook();
    emit();
    if (keys.current.size) invalidate();
  });

  return null;
}
