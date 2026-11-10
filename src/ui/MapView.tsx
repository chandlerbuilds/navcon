import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../routing/route';
import { IconFit, IconMinus, IconPlus } from './icons';
import { centroid, type Place, type Pt, type VenueBundle } from '../venue/types';

interface Props {
  venue: VenueBundle;
  route: Route | null;
  from?: Place;
  to?: Place;
  children?: React.ReactNode;
}

const pts = (poly: Pt[]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

function bboxOf(points: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/** Break a vendor name into at most two short lines at word boundaries, with an ellipsis if it still does not fit. */
function wrapName(name: string, max = 13): string[] {
  const lines: string[] = [];
  for (const word of name.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  const out = lines.slice(0, 2).map((l) => (l.length > max + 2 ? l.slice(0, max + 1) + '…' : l));
  if (lines.length > 2) out[1] = (out[1].length > max - 1 ? out[1].slice(0, max - 1) : out[1]) + '…';
  return out;
}

/** The floor plan, drawn by the app itself so it works with no network. Pan with one finger, pinch to zoom. */
export function MapView({ venue, route, from, to, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<SVGGElement>(null);
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [detail, setDetail] = useState(0); // 0 = far, 1 = area names, 2 = booth numbers

  const apply = useCallback(() => {
    const { k, tx, ty } = view.current;
    world.current?.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
    world.current?.querySelectorAll<SVGCircleElement>('.dot').forEach((c) => c.setAttribute('r', String(8 / k)));
    world.current?.style.setProperty('--ik', String(1 / k));
    setDetail(k >= 4 ? 2 : k >= 2.1 ? 1 : 0);
  }, []);

  const fit = useCallback((b: [number, number, number, number], pad = 28) => {
    const el = box.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const w = Math.max(b[2] - b[0], 12), h = Math.max(b[3] - b[1], 12);
    const right = pad + 44; // keep clear of the zoom buttons
    const k = Math.min((W - pad - right) / w, (H - pad * 2) / h, 14);
    view.current = { k, tx: (W - right + pad) / 2 - ((b[0] + b[2]) / 2) * k, ty: H / 2 - ((b[1] + b[3]) / 2) * k };
    apply();
  }, [apply]);

  const fitAll = useCallback(() => fit(bboxOf(venue.outline)), [fit, venue]);

  const focus = useMemo<Pt[] | null>(() => {
    if (route) return [...route.path, route.from.center, route.to.center];
    const p = to ?? from;
    return p ? [[p.center[0] - 25, p.center[1] - 25], [p.center[0] + 25, p.center[1] + 25]] : null;
  }, [route, from, to]);

  useLayoutEffect(() => { if (focus) fit(bboxOf(focus), 44); else fitAll(); }, [focus, fit, fitAll]);
  // Refit when the map's own area changes size, for example when the sheet below it is collapsed.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }
      if (focus) fit(bboxOf(focus), 44); else fitAll();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [focus, fit, fitAll]);
  useLayoutEffect(() => { apply(); }, [route, from, to, apply]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const v = view.current;
    const k = Math.min(40, Math.max(0.6, v.k * factor));
    v.tx = cx - (cx - v.tx) * (k / v.k);
    v.ty = cy - (cy - v.ty) * (k / v.k);
    v.k = k;
    apply();
  }, [apply]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const v = view.current;
    if (ps.size === 1) {
      v.tx += e.clientX - prev.x;
      v.ty += e.clientY - prev.y;
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
      return;
    }
    const other = [...ps.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
    const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y) || 1;
    const m0 = { x: (prev.x + other.x) / 2 - r.left, y: (prev.y + other.y) / 2 - r.top };
    const m1 = { x: (e.clientX + other.x) / 2 - r.left, y: (e.clientY + other.y) / 2 - r.top };
    v.tx += m1.x - m0.x;
    v.ty += m1.y - m0.y;
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    zoomAt(m1.x, m1.y, d1 / d0);
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };

  const lit = useMemo(() => {
    if (!route) return null;
    return new Set([route.from.id, route.to.id, ...route.marks]);
  }, [route]);
  const cls = (id: string, base: string) => `${base}${lit && !lit.has(id) ? ' dim' : ''}${id === from?.id ? ' is-from' : ''}${id === to?.id ? ' is-to' : ''}`;

  const booths = useMemo(() => venue.booths.map((b) => {
    const bb = bboxOf(b.poly);
    const size = Math.min(bb[2] - bb[0], bb[3] - bb[1]);
    return { b, c: centroid(b.poly), font: Math.max(0.7, Math.min(2.6, size * 0.36)), big: size > 5 };
  }), [venue]);
  const areas = useMemo(() => venue.areas.map((a) => {
    const bb = bboxOf(a.poly);
    return { a, c: centroid(a.poly), tall: bb[3] - bb[1] > (bb[2] - bb[0]) * 1.6, w: Math.max(bb[2] - bb[0], bb[3] - bb[1]) };
  }), [venue]);

  const pins = useMemo(() => {
    const ids = route ? [...new Set([...route.marks, route.from.id, route.to.id])] : [from?.id, to?.id].filter((x): x is string => !!x);
    const short = (t: string) => (t.length > 22 ? t.slice(0, 21) + '…' : t);
    const out: { id: string; at: Pt; text: string }[] = [];
    for (const id of ids) {
      const b = venue.booths.find((x) => x.id === id);
      if (b) { out.push({ id, at: centroid(b.poly), text: short(b.name ? `${b.name} ${b.number}` : `Booth ${b.number}`) }); continue; }
      const a = venue.areas.find((x) => x.id === id);
      if (a) { out.push({ id, at: centroid(a.poly), text: short(a.name.replace(/ \(.*\)$/, '')) }); continue; }
      const p = venue.points.find((x) => x.id === id);
      if (p) out.push({ id, at: p.at, text: short(p.name) });
    }
    return out;
  }, [venue, route, from, to]);

  // dotted arc from the end of the route into the place: to its door if it has one, else to its middle
  const spur = (p: Pt, place: Place) => {
    let t = place.center;
    if (place.doors?.length) t = place.doors.reduce((a, b) => (Math.hypot(a[0] - p[0], a[1] - p[1]) <= Math.hypot(b[0] - p[0], b[1] - p[1]) ? a : b));
    // An arc of round dots, the way map apps show the last few steps off the path.
    // It always bows toward the top of the screen (concave down), whichever way the route arrives.
    const dx = t[0] - p[0], dy = t[1] - p[1];
    let nx = -dy, ny = dx; // one of the two perpendiculars to the chord
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; } // take the one that points up; for a vertical chord, left
    const cx = (p[0] + t[0]) / 2 + nx * 0.24, cy = (p[1] + t[1]) / 2 + ny * 0.24;
    return <path className="spur" d={`M${p[0]} ${p[1]} Q${cx} ${cy} ${t[0]} ${t[1]}`} />;
  };
  const doors = useMemo(() => [...venue.booths, ...venue.areas].flatMap((x) => (x.doors ?? []).map((d, i) => ({ key: `${x.id}-${i}`, d }))), [venue]);

  const routePts = route ? pts(route.path) : '';
  const startDot = route ? route.path[0] : from?.center;
  const endDot = route ? route.path[route.path.length - 1] : to?.center;

  return (
    <div className="map" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <svg width="100%" height="100%" role="img" aria-label={route ? `Map showing the route from ${route.from.title} to ${route.to.title}` : `Floor plan of ${venue.name}`}>
        <g ref={world}>
          {venue.zones.map((z) => <polygon key={z.id} points={pts(z.poly)} fill={z.color} />)}
          <polygon points={pts(venue.outline)} className="outline" />
          {areas.map(({ a }) => <polygon key={a.id} points={pts(a.poly)} className={cls(a.id, 'area')} />)}
          {booths.map(({ b }) => <polygon key={b.id} points={pts(b.poly)} className={cls(b.id, 'booth')} fill={venue.tiers[b.tier] ?? '#ccc'} />)}
          {route && route.from.poly && spur(route.path[0], route.from)}
          {route && route.to.poly && spur(route.path[route.path.length - 1], route.to)}
          {route && <polyline points={routePts} className="route-case" />}
          {route && <polyline points={routePts} className="route-line" />}
          {doors.map(({ key, d }) => <rect key={key} className="door" x={d[0] - 0.6} y={d[1] - 0.6} width={1.2} height={1.2} />)}
          {venue.points.filter((p) => p.kind === 'hall').map((p) => (
            <text key={p.id} x={p.at[0]} y={p.at[1]} className="lbl hall">{p.name.toUpperCase()}</text>
          ))}
          {/* during a route, sponsor-named areas that are not part of it lose their name too; plain facilities keep theirs */}
          {detail >= 1 && areas.filter(({ a }) => !(route && lit && !lit.has(a.id) && (a.kind === 'lounge' || (a.kind === 'food' && !a.name.startsWith('Meal'))))).map(({ a, c, tall, w }) => {
            const name = a.name.replace(/ \(.*\)$/, '');
            const dim = lit && !lit.has(a.id) ? ' dim' : '';
            // A name too long for its shape used to spill onto the floor colour at a tiny size.
            // It now gets the same white card as vendor names, wrapped by word.
            if (!tall && name.length * 0.62 * 1.5 > w) {
              const f = 1.2, lines = wrapName(name);
              const cw = Math.max(...lines.map((l) => l.length)) * f * 0.6 + f * 1.1, ch = lines.length * f * 1.2 + f * 0.55;
              const top = c[1] - ch / 2;
              return (
                <g key={a.id} className={`name-card${dim}`}>
                  <rect x={c[0] - cw / 2} y={top} width={cw} height={ch} rx={f * 0.45} />
                  {lines.map((l, i) => <text key={i} x={c[0]} y={top + f * 0.275 + f * 1.2 * (i + 0.5)} className="lbl" style={{ fontSize: f }}>{l}</text>)}
                </g>
              );
            }
            return (
              <text key={a.id} x={c[0]} y={c[1]} className={`lbl area-name${dim}`}
                transform={tall ? `rotate(-90 ${c[0]} ${c[1]})` : undefined} style={{ fontSize: Math.max(1.1, Math.min(2.4, w / (name.length * 0.62))) }}>
                {name}
              </text>
            );
          })}
          {detail >= 1 && venue.points.filter((p) => p.kind === 'restroom' || p.kind === 'entrance').map((p) => (
            <text key={p.id} x={p.at[0]} y={p.at[1]} className="lbl poi">{p.kind === 'restroom' ? 'WC' : '▲ ' + p.name.replace(' Entrance', '').replace(/ \(.*\)$/, '')}</text>
          ))}
          {/* booth numbers stay during a route; vendor names are removed so only the route's own labels remain */}
          {detail >= 2 && booths.map(({ b, c, font, big }) => (
            <text key={b.id} x={c[0]} y={c[1]} className={`lbl num${lit && !lit.has(b.id) ? ' dim' : ''}`} style={{ fontSize: font }}>
              {b.number}
            </text>
          ))}
          {/* vendor names sit on a small white card under the number, wrapped by word, so they read on any booth colour */}
          {detail >= 2 && !route && booths.filter(({ b, big }) => big && b.name).map(({ b, c, font }) => {
            const f = font * 0.46, lines = wrapName(b.name!);
            const w = Math.max(...lines.map((l) => l.length)) * f * 0.6 + f * 1.1, h = lines.length * f * 1.2 + f * 0.55;
            const top = c[1] + font * 0.62;
            return (
              <g key={`n-${b.id}`} className="name-card">
                <rect x={c[0] - w / 2} y={top} width={w} height={h} rx={f * 0.45} />
                {lines.map((l, i) => <text key={i} x={c[0]} y={top + f * 0.275 + f * 1.2 * (i + 0.5)} className="lbl" style={{ fontSize: f }}>{l}</text>)}
              </g>
            );
          })}
          {pins.map((p) => <text key={p.id} x={p.at[0]} y={p.at[1]} className="lbl pin">{p.text}</text>)}
          {startDot && <circle cx={startDot[0]} cy={startDot[1]} className="dot dot-from" />}
          {endDot && <circle cx={endDot[0]} cy={endDot[1]} className="dot dot-to" />}
        </g>
      </svg>
      <div className="map-ctl">
        <button onClick={() => { const el = box.current!; zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1.5); }} aria-label="Zoom in"><IconPlus /></button>
        <button onClick={() => { const el = box.current!; zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1 / 1.5); }} aria-label="Zoom out"><IconMinus /></button>
        <button onClick={() => (focus ? fit(bboxOf(focus), 44) : fitAll())} aria-label={route ? 'Show the whole route' : 'Show the whole venue'}><IconFit /></button>
      </div>
      {children}
    </div>
  );
}
