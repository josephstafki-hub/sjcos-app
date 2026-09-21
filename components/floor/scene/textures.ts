// Procedural CanvasTextures for the 3D view. Client-only (guards on
// `document`), cached by key so a kitchen with forty matching cabinets shares
// one texture. Every texture reports the physical size (inches) of one repeat
// in `userData.sizeIn` so callers can set `repeat` for their surface.

import * as THREE from "three";
import type { FinishRef, TilePattern } from "@/lib/plan-doc";

const cache = new Map<string, THREE.CanvasTexture>();

export const canDraw = (): boolean => typeof document !== "undefined";

/** Physical inches covered by one texture repeat. */
export function textureSizeIn(t: THREE.Texture): number {
  const s = (t.userData as { sizeIn?: number }).sizeIn;
  return typeof s === "number" && s > 0 ? s : 24;
}

// ─── Colour helpers ──────────────────────────────────────────────────────────

export function isHex(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
}

export function shade(hex: string, amt: number): string {
  const c = new THREE.Color(isHex(hex) ? hex : "#cccccc");
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

/** Deterministic PRNG so a colour always yields the same grain/veins. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(
  key: string,
  px: number,
  py: number,
  sizeIn: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture | null {
  if (!canDraw()) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = py;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, px, py);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData = { sizeIn };
  cache.set(key, tex);
  return tex;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Straight-grain wood; one repeat = 24" × 24". */
export function woodGrain(colorHex: string): THREE.CanvasTexture | null {
  const base = isHex(colorHex) ? colorHex : "#c9a36a";
  return make(`wood:${base}`, 256, 256, 24, (ctx, w, h) => {
    const r = rng(base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const dark = shade(base, -0.09);
    const light = shade(base, 0.05);
    for (let i = 0; i < 70; i++) {
      const y0 = r() * h;
      const amp = 2 + r() * 6;
      const freq = 0.01 + r() * 0.02;
      ctx.strokeStyle = r() > 0.6 ? light : dark;
      ctx.globalAlpha = 0.25 + r() * 0.35;
      ctx.lineWidth = 0.6 + r() * 1.4;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = y0 + Math.sin(x * freq + i) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Tile field with grout lines. Straight / offset are drawn per layout;
 *  diagonal and herringbone reuse those with the texture rotated 45°. */
export function tile(pattern: TilePattern, colorHex: string, groutHex?: string): THREE.CanvasTexture | null {
  const base = isHex(colorHex) ? colorHex : "#d8d4cc";
  const grout = isHex(groutHex ?? pattern.groutColor) ? (groutHex ?? pattern.groutColor) : "#9a9590";
  const tw = Math.max(1, pattern.tileWIn);
  const th = Math.max(1, pattern.tileHIn);
  const g = Math.max(0.0625, pattern.groutIn);
  const offset = pattern.layout === "offset" || pattern.layout === "herringbone";
  // One repeat: 2 tiles wide × 2 tiles tall so the offset row fits.
  const repeatW = tw * 2;
  const repeatH = th * 2;
  const sizeIn = repeatW; // square repeat is simplest: scale y by aspect below
  const ppi = Math.max(4, Math.min(24, Math.floor(512 / Math.max(repeatW, repeatH))));
  const px = Math.round(repeatW * ppi);
  const py = Math.round(repeatH * ppi);
  const key = `tile:${pattern.layout}:${tw}x${th}:${g}:${base}:${grout}`;
  const tex = make(key, px, py, sizeIn, (ctx, w, h) => {
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, w, h);
    const r = rng(key);
    const gp = g * ppi;
    const twp = tw * ppi;
    const thp = th * ppi;
    for (let row = -1; row <= 2; row++) {
      const shift = offset && row % 2 !== 0 ? twp / 2 : 0;
      for (let col = -1; col <= 2; col++) {
        const x = col * twp + shift + gp / 2;
        const y = row * thp + gp / 2;
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.06);
        ctx.fillRect(x, y, twp - gp, thp - gp);
      }
    }
  });
  if (tex) {
    // Non-square repeat: stretch the repeat count per axis in callers via
    // sizeIn on x and aspect on y.
    tex.userData = { sizeIn, aspect: repeatH / repeatW };
    if (pattern.layout === "diagonal" || pattern.layout === "herringbone") {
      tex.center.set(0.5, 0.5);
      tex.rotation = Math.PI / 4;
    }
  }
  return tex;
}

/** Soft veining on a stone/quartz colour; one repeat = 36" × 36". */
export function stoneVeining(colorHex: string): THREE.CanvasTexture | null {
  const base = isHex(colorHex) ? colorHex : "#e6e2da";
  return make(`stone:${base}`, 256, 256, 36, (ctx, w, h) => {
    const r = rng(base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const vein = shade(base, -0.18);
    const soft = shade(base, -0.06);
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = i % 3 === 0 ? vein : soft;
      ctx.globalAlpha = 0.18 + r() * 0.3;
      ctx.lineWidth = 0.5 + r() * 1.5;
      ctx.beginPath();
      const x0 = r() * w;
      const y0 = r() * h;
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + (r() - 0.5) * w, y0 + (r() - 0.5) * h, x0 + (r() - 0.5) * w, y0 + (r() - 0.5) * h, r() * w, r() * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Best-effort texture for a finish: tile when it has a pattern, wood/stone by
 *  key prefix, null otherwise. */
export function finishTexture(f: FinishRef | null | undefined): THREE.CanvasTexture | null {
  if (!f) return null;
  if (f.pattern) return tile(f.pattern, f.color);
  const k = `${f.textureKey ?? ""} ${f.key}`.toLowerCase();
  if (/(^|\s)(wood-|floor-wood|hardwood|oak|walnut|maple)/.test(k)) return woodGrain(f.color);
  if (/(^|\s)(stone-|quartz-|marble|granite|quartzite)/.test(k)) return stoneVeining(f.color);
  return null;
}

/** A clone of `tex` repeating to cover `uIn × vIn` inches. Dispose the clone
 *  when done; the source canvas stays cached. */
export function repeatFor(tex: THREE.Texture, uIn: number, vIn: number): THREE.Texture {
  const size = textureSizeIn(tex);
  const aspect = (tex.userData as { aspect?: number }).aspect ?? 1;
  const c = tex.clone();
  c.repeat.set(uIn / size, vIn / (size * aspect));
  c.needsUpdate = true;
  return c;
}
