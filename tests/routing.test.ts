import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dist, distPointPoly, pointInPoly, segmentHitsPoly } from '../src/routing/geometry';
import { cellCenter, MARGIN, type Profile } from '../src/routing/grid';
import { Router } from '../src/routing/route';
import { searchLocal } from '../src/search/local';
import type { Pt, VenueBundle } from '../src/venue/types';

const venue = JSON.parse(readFileSync(new URL('../public/venues/kcna26.json', import.meta.url), 'utf8')) as VenueBundle;
const router = new Router(venue);
const profiles: Profile[] = ['standard', 'nostairs', 'wheelchair'];
const obstacles: { id: string; poly: Pt[] }[] = [...venue.booths, ...venue.areas];

// deterministic pseudo-random pairs so failures are reproducible
function pairs(n: number): [string, string][] {
  let seed = 20261109;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const ids = router.places.map((p) => p.id);
  return Array.from({ length: n }, () => [ids[Math.floor(rnd() * ids.length)], ids[Math.floor(rnd() * ids.length)]] as [string, string]);
}

describe('venue data', () => {
  it('has every booth numbered once and the expected totals', () => {
    const nums = venue.booths.map((b) => b.number);
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums.length).toBe(237);
    expect(venue.booths.filter((b) => !b.name).map((b) => b.number)).toEqual(['261']);
  });
});

describe('reachability', () => {
  for (const profile of profiles) {
    it(`every place has a walkable access point (${profile})`, () => {
      const g = router.grid(profile);
      const unreachable = router.places.filter((p) => {
        const cells = router.access(p, profile);
        return !cells.length || Math.min(...cells.map((c) => dist(cellCenter(g, c), p.center))) > 45;
      });
      expect(unreachable.map((p) => p.id)).toEqual([]);
    });
  }
});

describe('routes', () => {
  for (const profile of profiles) {
    it(`never cross an obstacle or leave the hall (${profile})`, () => {
      for (const [a, b] of pairs(120)) {
        const r = router.route(a, b, profile);
        expect(r.ok, `${a} -> ${b}`).toBe(true);
        if (!r.ok) continue;
        const { path } = r.route;
        for (const p of path) expect(pointInPoly(p[0], p[1], venue.outline), `${a} -> ${b} leaves the hall`).toBe(true);
        for (let i = 1; i < path.length; i++) {
          for (const o of obstacles) {
            expect(segmentHitsPoly(path[i - 1], path[i], o.poly), `${a} -> ${b} crosses ${o.id}`).toBe(false);
          }
        }
        const straight = dist(path[0], path[path.length - 1]);
        expect(r.route.meters).toBeGreaterThanOrEqual(straight - 0.01);
        expect(r.route.steps.length).toBeGreaterThan(0);
      }
    });
  }

  it('keep the promised clearance from every obstacle', () => {
    for (const profile of ['standard', 'wheelchair'] as Profile[]) {
      for (const [a, b] of pairs(40)) {
        const r = router.route(a, b, profile);
        if (!r.ok) continue;
        const { path } = r.route;
        let worst = Infinity;
        for (let i = 1; i < path.length; i++) {
          const len = dist(path[i - 1], path[i]), n = Math.max(1, Math.ceil(len / 0.5));
          for (let k = 0; k <= n; k++) {
            const x = path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / n;
            const y = path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / n;
            for (const o of obstacles) {
              const c = o.poly[0];
              if (Math.abs(c[0] - x) > 40 || Math.abs(c[1] - y) > 80) continue;
              worst = Math.min(worst, distPointPoly(x, y, o.poly));
            }
          }
        }
        expect(worst, `${a} -> ${b} (${profile})`).toBeGreaterThanOrEqual(MARGIN[profile] - 0.05);
      }
    }
  });

  it('turn only in 45 degree steps, and squarely in the square halls', () => {
    for (const [a, b] of pairs(60)) {
      const r = router.route(a, b, 'standard');
      if (!r.ok) continue;
      const { path } = r.route;
      for (let i = 1; i < path.length; i++) {
        const deg = (Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]) * 180) / Math.PI;
        const off = Math.abs(deg / 45 - Math.round(deg / 45));
        expect(off, `${a} -> ${b} has a segment at ${deg.toFixed(1)} degrees`).toBeLessThan(0.001);
      }
    }
    // Hall 3 booths stand square to the walls, so a route between two of them has no diagonal legs
    const r = router.route('b259', 'b327', 'standard');
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (let i = 1; i < r.route.path.length; i++) {
        const [p, q] = [r.route.path[i - 1], r.route.path[i]];
        expect(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6, 'diagonal leg in a square hall').toBe(true);
      }
    }
  });

  it('run down the middle of a wide aisle, not along its wall', () => {
    const g = router.grid('standard');
    const r = router.route('meal-halls-a-b', 'hall-2', 'standard');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { path } = r.route;
    let sum = 0, n = 0;
    for (let i = 1; i < path.length; i++) {
      const steps = Math.max(1, Math.ceil(dist(path[i - 1], path[i]) / 0.5));
      for (let k = 0; k <= steps; k++) {
        const x = path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / steps, y = path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / steps;
        sum += g.clear[Math.floor(y / g.cell) * g.w + Math.floor(x / g.cell)]; n++;
      }
    }
    expect(sum / n, 'average distance from the nearest wall, in metres').toBeGreaterThan(1.5);
  });

  it('leave a place on the side that suits the trip, never from a cramped gap behind it', () => {
    const store = venue.areas.find((a) => a.id === 'corner-store')!;
    const south = Math.max(...store.poly.map((p) => p[1]));
    const r = router.route('corner-store', 'b243', 'standard');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.route.path[0][1], 'the route should start south of the Corner Store').toBeGreaterThan(south);
    const back = router.route('b243', 'corner-store', 'standard');
    if (back.ok) expect(back.route.path[back.route.path.length - 1][1]).toBeGreaterThan(south);
  });

  it('use the door when a place has one, even if another side is nearer', () => {
    const withDoor = structuredClone(venue);
    const theater = withDoor.areas.find((a) => a.id === 'cloud-native-theater')!;
    const xs = theater.poly.map((p) => p[0]), ys = theater.poly.map((p) => p[1]);
    const eastDoor: Pt = [Math.max(...xs), (Math.min(...ys) + Math.max(...ys)) / 2];
    theater.doors = [eastDoor];
    const end = (o: ReturnType<Router['route']>) => (o.ok ? o.route.path[o.route.path.length - 1] : ([NaN, NaN] as Pt));
    const start = (o: ReturnType<Router['route']>) => (o.ok ? o.route.path[0] : ([NaN, NaN] as Pt));
    const doorRouter = new Router(withDoor);
    // coming up from the south, the nearest side is not the east one
    expect(dist(end(router.route('b243', 'cloud-native-theater', 'standard')), eastDoor)).toBeGreaterThan(5);
    expect(dist(end(doorRouter.route('b243', 'cloud-native-theater', 'standard')), eastDoor)).toBeLessThan(2.5);
    expect(dist(start(doorRouter.route('cloud-native-theater', 'b243', 'standard')), eastDoor)).toBeLessThan(2.5);
  });

  it('routes across the whole venue quickly', () => {
    router.grid('standard');
    const t0 = performance.now();
    const r = router.route('main-entrance', 'cloud-native-theater', 'standard');
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(1000);
  });
});

describe('offline search', () => {
  const find = (q: string) => searchLocal(router.places, q).map((p) => p.id);
  it('finds booths by number, name and typo', () => {
    expect(find('134')[0]).toBe('b134');
    expect(find('dash0')[0]).toBe('b134');
    expect(find('elastic')[0]).toBe('b196');
    expect(find('radar')[0]).toBe('b365');
    expect(find('datadgo')[0]).toBe('b152');
    expect(find('clickhuose')[0]).toBe('b108');
  });
  it('finds exhibitors by what they do', () => {
    const ids = find('observability');
    expect(ids).toContain('b134');
    expect(ids).toContain('b152');
    expect(find('geofencing')[0]).toBe('b365');
    expect(find('postgres').length).toBeGreaterThan(3);
  });
  it('finds landmarks and synonyms', () => {
    expect(find('main entrance')[0]).toBe('main-entrance');
    expect(find('bathroom').length).toBeGreaterThan(0);
    expect(find('demo theater')[0]).toBe('demo-theater');
  });
});
