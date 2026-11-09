import type { Pt, VenueBundle } from '../venue/types';
import { distPointSeg, pointInPoly } from './geometry';

export const CELL = 0.5; // metres

export type Profile = 'standard' | 'nostairs' | 'wheelchair';

/** Clearance kept between a route and any wall or booth edge, in metres. */
export const MARGIN: Record<Profile, number> = { standard: 0.3, nostairs: 0.3, wheelchair: 0.5 };

export interface Grid {
  cell: number;
  w: number;
  h: number;
  margin: number;
  /** 1 = not walkable. Free cells form one connected area. */
  blocked: Uint8Array;
  /** Distance from each cell to the nearest non-walkable cell, in metres. */
  clear: Float32Array;
  /** Cost of walking one metre through each cell: 1 in open floor, more near walls, so routes keep to the middle of an aisle. */
  cost: Float32Array;
  /** 1 where the nearest booth or wall is turned 45 degrees, so the aisles there run diagonally. */
  diag: Uint8Array;
}

/** True when a shape's longest edge runs diagonally (booths in Halls A to C are turned 45 degrees). */
function isDiagonal(poly: Pt[]): boolean {
  let best = 0, angle = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const dx = poly[i][0] - poly[j][0], dy = poly[i][1] - poly[j][1];
    const len = dx * dx + dy * dy;
    if (len > best) { best = len; angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 90; }
  }
  return angle > 22.5 && angle < 67.5;
}

export function cellCenter(g: Grid, idx: number): Pt {
  return [((idx % g.w) + 0.5) * g.cell, (Math.floor(idx / g.w) + 0.5) * g.cell];
}

/**
 * Rasterise the venue into walkable cells.
 * A cell is free when every point in it keeps at least `margin` from the hall
 * outline and from every obstacle, so a path through free cells can never touch one.
 */
export function buildGrid(v: VenueBundle, margin: number): Grid {
  const w = Math.ceil(v.size[0] / CELL), h = Math.ceil(v.size[1] / CELL);
  const blocked = new Uint8Array(w * h).fill(1);
  const slanted = new Uint8Array(w * h); // orientation of whatever blocked each cell
  const eff = margin + CELL * Math.SQRT1_2;

  // 1. Cells whose centre is inside the hall outline start free (scanline fill).
  const o = v.outline;
  const xs: number[] = [];
  for (let cy = 0; cy < h; cy++) {
    const y = (cy + 0.5) * CELL;
    xs.length = 0;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const [x1, y1] = o[j], [x2, y2] = o[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5)), c1 = Math.min(w - 1, Math.floor(xs[k + 1] / CELL - 0.5));
      for (let cx = c0; cx <= c1; cx++) blocked[cy * w + cx] = 0;
    }
  }

  const blockNear = (poly: Pt[], filled: boolean) => {
    const diagonal = isDiagonal(poly) ? 1 : 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const cx0 = Math.max(0, Math.floor((minX - eff) / CELL)), cx1 = Math.min(w - 1, Math.floor((maxX + eff) / CELL));
    const cy0 = Math.max(0, Math.floor((minY - eff) / CELL)), cy1 = Math.min(h - 1, Math.floor((maxY + eff) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const idx = cy * w + cx;
        if (blocked[idx]) continue;
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
        if (filled && pointInPoly(x, y, poly)) { blocked[idx] = 1; slanted[idx] = diagonal; continue; }
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if (distPointSeg(x, y, poly[j], poly[i]) < eff) { blocked[idx] = 1; slanted[idx] = diagonal; break; }
        }
      }
    }
  };

  // 2. Keep clear of the walls: each outline edge blocks the cells within the margin.
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) blockNear([o[j], o[i]], false);
  // 3. Obstacles: booths and service areas, grown by the margin.
  for (const b of v.booths) blockNear(b.poly, true);
  for (const a of v.areas) blockNear(a.poly, true);

  keepLargestComponent(blocked, w, h);
  const { clear, diag } = clearance(blocked, slanted, w, h);
  const cost = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // strong push away from the last 1.5 m beside a wall, gentle pull toward the middle of wide aisles
    const near = Math.max(0, 1.5 - clear[i]) / 1.5, mid = Math.max(0, 5 - clear[i]) / 5;
    cost[i] = 1 + 2 * near * near + 0.25 * mid;
  }
  return { cell: CELL, w, h, margin, blocked, clear, cost, diag };
}

/** Two-pass distance transform: how far each free cell is from the nearest blocked one, and that blocker's orientation. */
function clearance(blocked: Uint8Array, slanted: Uint8Array, w: number, h: number): { clear: Float32Array; diag: Uint8Array } {
  const d = new Float32Array(w * h), diag = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { d[i] = blocked[i] ? 0 : 1e9; diag[i] = blocked[i] ? slanted[i] : 0; }
  const take = (i: number, from: number, step: number) => {
    if (d[from] + step < d[i]) { d[i] = d[from] + step; diag[i] = diag[from]; }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    if (x > 0) take(i, i - 1, 1);
    if (y > 0) { take(i, i - w, 1); if (x > 0) take(i, i - w - 1, Math.SQRT2); if (x < w - 1) take(i, i - w + 1, Math.SQRT2); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    if (x < w - 1) take(i, i + 1, 1);
    if (y < h - 1) { take(i, i + w, 1); if (x < w - 1) take(i, i + w + 1, Math.SQRT2); if (x > 0) take(i, i + w - 1, Math.SQRT2); }
  }
  for (let i = 0; i < w * h; i++) d[i] = Math.min(d[i] * CELL, 50);
  return { clear: d, diag };
}

/** Block every free pocket that is cut off from the main floor. */
function keepLargestComponent(blocked: Uint8Array, w: number, h: number): void {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < w * h; s++) {
    if (blocked[s] || label[s]) continue;
    next++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; label[s] = next;
    while (head < tail) {
      const c = queue[head++]; size++;
      const cx = c % w;
      if (cx > 0 && !blocked[c - 1] && !label[c - 1]) { label[c - 1] = next; queue[tail++] = c - 1; }
      if (cx < w - 1 && !blocked[c + 1] && !label[c + 1]) { label[c + 1] = next; queue[tail++] = c + 1; }
      if (c >= w && !blocked[c - w] && !label[c - w]) { label[c - w] = next; queue[tail++] = c - w; }
      if (c + w < w * h && !blocked[c + w] && !label[c + w]) { label[c + w] = next; queue[tail++] = c + w; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let i = 0; i < w * h; i++) if (!blocked[i] && label[i] !== best) blocked[i] = 1;
}

/** Nearest walkable cell to a point, or -1 if none within maxDist metres. */
export function nearestFree(g: Grid, p: Pt, maxDist = 30): number {
  const pcx = Math.floor(p[0] / g.cell), pcy = Math.floor(p[1] / g.cell);
  const maxR = Math.ceil(maxDist / g.cell);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    if ((r - 1) * g.cell > bestD) break;
    for (let dy = -r; dy <= r; dy++) {
      const cy = pcy + dy;
      if (cy < 0 || cy >= g.h) continue;
      const edge = Math.abs(dy) === r;
      for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
        const cx = pcx + dx;
        if (cx < 0 || cx >= g.w) continue;
        const idx = cy * g.w + cx;
        if (g.blocked[idx]) continue;
        const d = Math.hypot((cx + 0.5) * g.cell - p[0], (cy + 0.5) * g.cell - p[1]);
        if (d < bestD) { bestD = d; best = idx; }
      }
    }
  }
  return bestD <= maxDist ? best : -1;
}

/**
 * The cells a person could be standing on when they are "at" a shape.
 * Booths and open areas rarely have a marked entrance, so this is the walkable
 * band around the whole shape; the route search then picks the side that suits
 * the trip. Cramped gaps (the strip behind a booth, against a wall) are left out
 * whenever the shape also faces a proper aisle.
 */
export function accessCells(g: Grid, poly: Pt[]): number[] {
  const reach = g.margin + g.cell * Math.SQRT1_2 + 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const cx0 = Math.max(0, Math.floor((minX - reach) / g.cell)), cx1 = Math.min(g.w - 1, Math.floor((maxX + reach) / g.cell));
  const cy0 = Math.max(0, Math.floor((minY - reach) / g.cell)), cy1 = Math.min(g.h - 1, Math.floor((maxY + reach) / g.cell));
  const near: number[] = [];
  let widest = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const idx = cy * g.w + cx;
      if (g.blocked[idx]) continue;
      const x = (cx + 0.5) * g.cell, y = (cy + 0.5) * g.cell;
      if (pointInPoly(x, y, poly)) continue;
      let d = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distPointSeg(x, y, poly[j], poly[i]));
      if (d > reach) continue;
      near.push(idx);
      if (g.clear[idx] > widest) widest = g.clear[idx];
    }
  }
  const need = Math.min(1, widest);
  return near.filter((idx) => g.clear[idx] >= need);
}

/** The single walkable cell for a point place such as a restroom sign or an entrance. */
export function accessCell(g: Grid, p: Pt, maxDist = 40): number {
  return nearestFree(g, p, maxDist);
}
