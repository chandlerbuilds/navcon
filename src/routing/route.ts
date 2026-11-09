import { placesOf, type Place, type Pt, type VenueBundle } from '../venue/types';
import { corners, findPath } from './astar';
import { dist, distPointPoly } from './geometry';
import { accessCell, accessCells, buildGrid, cellCenter, MARGIN, type Grid, type Profile } from './grid';

export const WALK_SPEED = 1.2; // metres per second

export interface Step { text: string; at: Pt }
export interface Route {
  from: Place;
  to: Place;
  profile: Profile;
  /** Corner points of the route in metres, from the start's access point to the destination's. */
  path: Pt[];
  meters: number;
  seconds: number;
  steps: Step[];
  /** Ids of the places named in the steps, for highlighting on the map. */
  marks: string[];
}
export type RouteOutcome = { ok: true; route: Route } | { ok: false; reason: string };

export const PROFILE_LABEL: Record<Profile, string> = { standard: 'Standard', nostairs: 'No stairs', wheelchair: 'Wheelchair' };

export function feet(m: number): number {
  const ft = m * 3.28084;
  return ft < 100 ? Math.max(5, Math.round(ft / 5) * 5) : Math.round(ft / 10) * 10;
}

function label(p: Place): string {
  return p.kind === 'booth' && p.number && !p.title.startsWith('Booth ') ? `${p.title} (booth ${p.number})` : p.title;
}

export class Router {
  readonly places: Place[];
  private readonly byId = new Map<string, Place>();
  private readonly grids = new Map<number, Grid>();
  private readonly landmarks: Place[];

  constructor(readonly venue: VenueBundle) {
    this.places = placesOf(venue);
    for (const p of this.places) this.byId.set(p.id, p);
    this.landmarks = this.places.filter((p) => p.poly);
  }

  place(id: string | null | undefined): Place | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  grid(profile: Profile): Grid {
    const m = MARGIN[profile];
    let g = this.grids.get(m);
    if (!g) { g = buildGrid(this.venue, m); this.grids.set(m, g); }
    return g;
  }

  /**
   * The walkable cells that count as being "at" a place.
   * A place with known doors is entered and left through a door, always.
   * Otherwise a booth or open area gives the band of floor around it, so a
   * route can use whichever side suits the trip.
   */
  access(place: Place, profile: Profile): number[] {
    const g = this.grid(profile);
    if (place.doors?.length) {
      const cells = place.doors.map((d) => accessCell(g, d, 15)).filter((c) => c >= 0);
      if (cells.length) return [...new Set(cells)];
    }
    if (place.poly) {
      const cells = accessCells(g, place.poly);
      if (cells.length) return cells;
    }
    const c = accessCell(g, place.center, 40);
    return c < 0 ? [] : [c];
  }

  route(fromId: string, toId: string, profile: Profile): RouteOutcome {
    const from = this.byId.get(fromId), to = this.byId.get(toId);
    if (!from || !to) return { ok: false, reason: 'That place is not on this map.' };
    const g = this.grid(profile);
    const a = this.access(from, profile), b = this.access(to, profile);
    const who = profile === 'standard' ? 'route' : `${PROFILE_LABEL[profile].toLowerCase()} route`;
    if (!a.length) return { ok: false, reason: `No ${who} from ${label(from)}.` };
    if (!b.length) return { ok: false, reason: `No ${who} to ${label(to)}.` };
    const cells = findPath(g, a, b);
    if (!cells) return { ok: false, reason: `No ${who} to ${label(to)}.` };
    const path = corners(g, cells).map((c) => cellCenter(g, c));
    let meters = 0;
    for (let i = 1; i < path.length; i++) meters += dist(path[i - 1], path[i]);
    const marks: string[] = [];
    const steps = this.steps(path, from, to, marks);
    return { ok: true, route: { from, to, profile, path, meters, seconds: meters / WALK_SPEED, steps, marks } };
  }

  private landmarkNear(p: Pt, skip: Place[]): Place | undefined {
    let best: Place | undefined, bestD = 10;
    for (const l of this.landmarks) {
      if (skip.includes(l)) continue;
      if (Math.abs(l.center[0] - p[0]) > 60 || Math.abs(l.center[1] - p[1]) > 60) continue;
      const d = distPointPoly(p[0], p[1], l.poly as Pt[]);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  private steps(raw: Pt[], from: Place, to: Place, marks: string[]): Step[] {
    if (raw.length < 2 || dist(raw[0], raw[raw.length - 1]) < 3) {
      return [{ text: `${label(to)} is right next to ${label(from)}.`, at: raw[0] ?? to.center }];
    }
    // drop corners that barely change direction, so the list reads as real turns
    const path: Pt[] = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const prev = path[path.length - 1];
      if (turn(prev, raw[i], raw[i + 1]).angle >= 25 && dist(prev, raw[i]) >= 4) path.push(raw[i]);
    }
    path.push(raw[raw.length - 1]);

    const skip = [from, to];
    const steps: Step[] = [];
    const firstMark = path.length > 2 ? this.landmarkNear(path[1], skip) : undefined;
    if (firstMark) marks.push(firstMark.id);
    steps.push({
      text: `Start at ${label(from)}. Walk ${feet(dist(path[0], path[1]))} ft${path.length === 2 ? ` to ${label(to)}` : firstMark ? ` toward ${label(firstMark)}` : ''}.`,
      at: path[0],
    });
    for (let i = 1; i < path.length - 1; i++) {
      const t = turn(path[i - 1], path[i], path[i + 1]);
      const side = t.right ? 'right' : 'left';
      const verb = t.angle < 50 ? `Bear ${side}` : t.angle > 130 ? `Turn sharply ${side}` : `Turn ${side}`;
      const mark = this.landmarkNear(path[i], skip);
      if (mark) marks.push(mark.id);
      steps.push({ text: `${verb}${mark ? ` at ${label(mark)}` : ''}, then walk ${feet(dist(path[i], path[i + 1]))} ft.`, at: path[i] });
    }
    const n = path.length;
    const t = turn(path[n - 2], path[n - 1], to.center);
    const where = dist(path[n - 1], to.center) < 1 || t.angle < 30 ? 'straight ahead' : `on your ${t.right ? 'right' : 'left'}`;
    steps.push({ text: `Arrive at ${label(to)}, ${where}.`, at: path[n - 1] });
    return steps;
  }
}

/** Turn at b when walking a -> b -> c. Screen coordinates (y grows downward). */
function turn(a: Pt, b: Pt, c: Pt): { angle: number; right: boolean } {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const cross = ux * vy - uy * vx, dot = ux * vx + uy * vy;
  return { angle: (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI, right: cross > 0 };
}
