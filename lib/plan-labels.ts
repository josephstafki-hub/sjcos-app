/** Move a label below colliding markers, retaining each marker's true location. */
export function clearLabelPosition(center: { x: number; y: number }, halfWidth: number, halfHeight: number, markers: readonly { x: number; y: number; radius: number; halfWidth?: number; halfHeight?: number }[]) {
  const p = { ...center };
  // Each pass clears at least one marker below the current label.
  for (let pass = 0; pass <= markers.length; pass++) {
    const hits = markers.filter(m => Math.abs(p.x - m.x) <= halfWidth + (m.halfWidth ?? m.radius) && Math.abs(p.y - m.y) <= halfHeight + (m.halfHeight ?? m.radius));
    if (!hits.length) break;
    p.y = Math.max(...hits.map(m => m.y + (m.halfHeight ?? m.radius) + halfHeight)) + 1;
  }
  return p;
}
