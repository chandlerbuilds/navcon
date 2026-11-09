import type { Grid } from './grid';

const SQRT2 = Math.SQRT2;

/** Shortest path over free cells, 8-connected, never cutting a blocked corner. Returns cell indices. */
export function findPath(g: Grid, start: number, goal: number): number[] | null {
  const { w, h, blocked } = g;
  if (start < 0 || goal < 0 || blocked[start] || blocked[goal]) return null;
  if (start === goal) return [start];
  const n = w * h;
  const gScore = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % w, gy = (goal / w) | 0;
  const heur = (i: number) => {
    const dx = Math.abs((i % w) - gx), dy = Math.abs(((i / w) | 0) - gy);
    return (dx + dy + (SQRT2 - 2) * Math.min(dx, dy)) * 1.0005;
  };

  // binary heap of [f, node] pairs kept in two parallel arrays
  const heapF: number[] = [], heapN: number[] = [];
  const push = (f: number, node: number) => {
    let i = heapF.length;
    heapF.push(f); heapN.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapF[i] = heapF[p]; heapN[i] = heapN[p]; i = p;
    }
    heapF[i] = f; heapN[i] = node;
  };
  const pop = (): number => {
    const top = heapN[0];
    const f = heapF.pop() as number, node = heapN.pop() as number;
    const len = heapF.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= f) break;
        heapF[i] = heapF[c]; heapN[i] = heapN[c]; i = c;
      }
      heapF[i] = f; heapN[i] = node;
    }
    return top;
  };

  gScore[start] = 0;
  push(heur(start), start);
  while (heapF.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = parent[c]) path.push(c);
      return path.reverse();
    }
    closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0, gc = gScore[cur];
    const L = cx > 0 && !blocked[cur - 1], R = cx < w - 1 && !blocked[cur + 1];
    const U = cy > 0 && !blocked[cur - w], D = cy < h - 1 && !blocked[cur + w];
    const relax = (nb: number, cost: number) => {
      if (closed[nb]) return;
      const ng = gc + cost;
      if (ng < gScore[nb]) { gScore[nb] = ng; parent[nb] = cur; push(ng + heur(nb), nb); }
    };
    if (L) relax(cur - 1, 1);
    if (R) relax(cur + 1, 1);
    if (U) relax(cur - w, 1);
    if (D) relax(cur + w, 1);
    if (L && U && !blocked[cur - w - 1]) relax(cur - w - 1, SQRT2);
    if (R && U && !blocked[cur - w + 1]) relax(cur - w + 1, SQRT2);
    if (L && D && !blocked[cur + w - 1]) relax(cur + w - 1, SQRT2);
    if (R && D && !blocked[cur + w + 1]) relax(cur + w + 1, SQRT2);
  }
  return null;
}

/** True when the straight line between two cell centres stays on free cells. */
export function lineOfSight(g: Grid, a: number, b: number): boolean {
  const { w, blocked } = g;
  const ax = (a % w) + 0.5, ay = ((a / w) | 0) + 0.5, bx = (b % w) + 0.5, by = ((b / w) | 0) + 0.5;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (blocked[Math.floor(ay + (by - ay) * t) * w + Math.floor(ax + (bx - ax) * t)]) return false;
  }
  return true;
}

/** Reduce a cell path to the few corners that matter (string pulling). */
export function simplify(g: Grid, path: number[]): number[] {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let far = anchor + 1;
    // gallop forward, then walk back to the farthest visible cell
    let step = 1, probe = anchor + 1;
    while (probe < path.length && lineOfSight(g, path[anchor], path[probe])) { far = probe; step *= 2; probe = anchor + step; }
    const hi = Math.min(probe, path.length - 1);
    for (let k = hi; k > far; k--) {
      if (lineOfSight(g, path[anchor], path[k])) { far = k; break; }
    }
    out.push(path[far]);
    anchor = far;
  }
  return out;
}
