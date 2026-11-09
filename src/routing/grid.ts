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
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const cx0 = Math.max(0, Math.floor((minX - eff) / CELL)), cx1 = Math.min(w - 1, Math.floor((maxX + eff) / CELL));
    const cy0 = Math.max(0, Math.floor((minY - eff) / CELL)), cy1 = Math.min(h - 1, Math.floor((maxY + eff) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const idx = cy * w + cx;
        if (blocked[idx]) continue;
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
        if (filled && pointInPoly(x, y, poly)) { blocked[idx] = 1; continue; }
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if (distPointSeg(x, y, poly[j], poly[i]) < eff) { blocked[idx] = 1; break; }
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
  return { cell: CELL, w, h, margin, blocked };
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
