import type { Grid } from './grid';

// Eight walking directions, clockwise from east. Odd indices are diagonal.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const LEN = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

/** Cost of changing direction by 0, 45, 90, 135 and 180 degrees, in metres of walking. Keeps routes to a few clean turns. */
const TURN = [0, 2, 3, 7, 12];
/** Walking against the grain of the local aisles (diagonally between square booths, or squarely between slanted ones) costs this much more. */
const OFF_AXIS = 1;

/**
 * Walking is never cheaper than 1 per metre and is usually dearer (aisle cost, turns), so the
 * straight-line estimate can be scaled up a little. That makes long searches several times
 * faster on a phone; in testing the routes came out the same or within a couple of metres.
 */
const H_WEIGHT = 1.2;

interface Scratch { size: number; g: Float32Array; parent: Int32Array; mark: Uint32Array; epoch: number }
let scratch: Scratch | null = null;

/**
 * Route over free cells so that the path
 *  - runs down the middle of aisles (cells near walls cost more),
 *  - follows the local aisle direction (square in Halls 1 to 5, 45 degrees in Halls A to C),
 *  - turns only in 45 degree steps, and as rarely as it can.
 * The search state is (cell, heading), which is what lets a turn carry a cost.
 *
 * A place usually has no marked entrance, so the search may begin on any of the
 * `starts` cells and finish on any of the `goals` cells: the route leaves and
 * reaches each place on whichever side suits the trip.
 * Returns every cell on the path, start to goal, or null.
 */
export function findPath(grid: Grid, starts: number[], goals: number[]): number[] | null {
  const { w, h, blocked, cost, diag, cell } = grid;
  starts = starts.filter((c) => c >= 0 && !blocked[c]);
  goals = goals.filter((c) => c >= 0 && !blocked[c]);
  if (!starts.length || !goals.length) return null;
  const isGoal = new Uint8Array(w * h);
  let gx0 = w, gy0 = h, gx1 = -1, gy1 = -1;
  for (const c of goals) {
    isGoal[c] = 1;
    const x = c % w, y = (c / w) | 0;
    if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
  }
  for (const c of starts) if (isGoal[c]) return [c];
  const n = w * h * 8;
  if (!scratch || scratch.size !== n) scratch = { size: n, g: new Float32Array(n), parent: new Int32Array(n), mark: new Uint32Array(n), epoch: 0 };
  const sc = scratch;
  if (sc.epoch > 2_000_000_000) { sc.mark.fill(0); sc.epoch = 0; }
  const OPEN = (sc.epoch += 2), CLOSED = OPEN + 1;
  const { g, parent, mark } = sc;

  // straight-line (octile) distance to the box around the goal cells: never an overestimate
  const heur = (c: number) => {
    const x = c % w, y = (c / w) | 0;
    const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0, dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * cell * H_WEIGHT;
  };

  const heapF: number[] = [], heapS: number[] = [];
  const push = (f: number, s: number) => {
    let i = heapF.length;
    heapF.push(f); heapS.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapF[i] = heapF[p]; heapS[i] = heapS[p]; i = p;
    }
    heapF[i] = f; heapS[i] = s;
  };
  const pop = (): number => {
    const top = heapS[0];
    const f = heapF.pop() as number, s = heapS.pop() as number;
    const len = heapF.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= f) break;
        heapF[i] = heapF[c]; heapS[i] = heapS[c]; i = c;
      }
      heapF[i] = f; heapS[i] = s;
    }
    return top;
  };

  /** Target cell of a move, or -1 when it would leave the floor or cut a blocked corner. */
  const step = (c: number, d: number): number => {
    const x = (c % w) + DX[d], y = ((c / w) | 0) + DY[d];
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const t = y * w + x;
    if (blocked[t]) return -1;
    if (d & 1 && (blocked[c + DX[d]] || blocked[c + DY[d] * w])) return -1;
    return t;
  };
  const moveCost = (from: number, to: number, d: number) =>
    LEN[d] * cell * 0.5 * (cost[from] + cost[to]) * ((d & 1) === diag[to] ? 1 : OFF_AXIS);

  const relax = (state: number, ng: number, from: number, c: number) => {
    if (mark[state] === CLOSED) return;
    if (mark[state] !== OPEN || ng < g[state]) {
      mark[state] = OPEN; g[state] = ng; parent[state] = from;
      push(ng + heur(c), state);
    }
  };

  // a first move from any start cell; the parent slot remembers which one (as a negative number)
  for (const start of starts) {
    for (let d = 0; d < 8; d++) {
      const t = step(start, d);
      if (t >= 0) relax(t * 8 + d, moveCost(start, t, d), -2 - start, t);
    }
  }
  while (heapF.length) {
    const s = pop();
    if (mark[s] === CLOSED) continue;
    mark[s] = CLOSED;
    const c = s >> 3, dir = s & 7;
    if (isGoal[c]) {
      const cells: number[] = [];
      let p = s;
      for (; p >= 0; p = parent[p]) cells.push(p >> 3);
      cells.push(-2 - p);
      return cells.reverse();
    }
    const gc = g[s];
    for (let d = 0; d < 8; d++) {
      const diff = Math.abs(d - dir);
      const turn = diff > 4 ? 8 - diff : diff;
      if (turn === 4) continue; // never double straight back
      const t = step(c, d);
      if (t >= 0) relax(t * 8 + d, gc + moveCost(c, t, d) + TURN[turn], s, t);
    }
  }
  return null;
}

/** Keep only the cells where the path changes direction. */
export function corners(grid: Grid, cells: number[]): number[] {
  if (cells.length <= 2) return cells;
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    if (cells[i] - cells[i - 1] !== cells[i + 1] - cells[i]) out.push(cells[i]);
  }
  out.push(cells[cells.length - 1]);
  return out;
}
