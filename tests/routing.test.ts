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
      const unreachable = router.places.filter((p) => {
        const c = router.access(p, profile);
        return c < 0 || dist(cellCenter(router.grid(profile), c), p.center) > 40;
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
  it('finds landmarks and synonyms', () => {
    expect(find('main entrance')[0]).toBe('main-entrance');
    expect(find('bathroom').length).toBeGreaterThan(0);
    expect(find('demo theater')[0]).toBe('demo-theater');
  });
});
