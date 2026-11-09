import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from './routing/grid';
import { feet, PROFILE_LABEL, Router, type RouteOutcome } from './routing/route';
import { track } from './telemetry';
import { MapView } from './ui/MapView';
import { ProfileMenu } from './ui/ProfileMenu';
import { IconOffline, IconPin, IconQr, IconSwap } from './ui/icons';
import { SearchSheet } from './ui/SearchSheet';
import type { Place, VenueBundle } from './venue/types';

const QrSheet = lazy(() => import('./ui/QrSheet'));
const ArrivalSheet = lazy(() => import('./ui/ArrivalSheet'));
const ScanSheet = lazy(() => import('./ui/ScanSheet'));
const RADAR_KEY = import.meta.env.VITE_RADAR_KEY as string | undefined;

const DEFAULT_VENUE = 'kcna26';
const PROFILES: Profile[] = ['standard', 'nostairs', 'wheelchair'];
const QUICK = ['main-entrance', 'restrooms-hall-b', 'restroom-hall-1-north', 'meal-halls-a-b', 'demo-theater', 'cloud-native-theater', 'project-pavilion', 'corner-store'];

function readUrl() {
  const parts = location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(location.search);
  const profile = q.get('profile') as Profile | null;
  let stored: Profile | null = null;
  try { stored = localStorage.getItem('navcon.profile') as Profile | null; } catch { /* private mode */ }
  return {
    venue: parts[0] === 'v' && parts[1] ? parts[1] : DEFAULT_VENUE,
    page: parts[2] === 'qr' ? ('qr' as const) : ('map' as const),
    from: q.get('from'),
    to: q.get('to'),
    viaQr: q.get('src') === 'qr',
    profile: PROFILES.includes(profile as Profile) ? (profile as Profile) : PROFILES.includes(stored as Profile) ? (stored as Profile) : 'standard',
  };
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [venue, setVenue] = useState<VenueBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(initial.from);
  const [toId, setToId] = useState<string | null>(initial.to);
  const [profile, setProfile] = useState<Profile>(initial.profile);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [arriving, setArriving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [collapsed, setCollapsed] = useState(false); // phone only: the sheet shrinks to one line so the map gets the screen
  const dragY = useRef<number | null>(null);
  const dragged = useRef(false);
  const hadRoute = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/venues/${encodeURIComponent(initial.venue)}.json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((v: VenueBundle) => { if (alive) setVenue(v); })
      .catch(() => { if (alive) setLoadError('This venue could not be loaded. Check your connection and try again.'); });
    return () => { alive = false; };
  }, [initial.venue]);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  const router = useMemo(() => (venue ? new Router(venue) : null), [venue]);

  // Build the walkable grid ahead of the first route, off the critical path.
  useEffect(() => {
    if (!router) return;
    const t = setTimeout(() => router.grid(profile), 50);
    return () => clearTimeout(t);
  }, [router, profile]);

  // A QR code for a place that has since been removed opens the venue with an empty start.
  useEffect(() => {
    if (!router) return;
    if (fromId && !router.place(fromId)) { setFromId(null); setNotice('That QR code points to a place that is no longer on this map. Choose where you are.'); }
    else if (fromId && initial.viaQr && fromId === initial.from) track('qr_scan', { place: fromId });
    if (toId && !router.place(toId)) setToId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const from = router?.place(fromId), to = router?.place(toId);

  // A booth's QR code read by the in-app scanner sets the start, the same as opening its link.
  const onScan = useCallback((id: string) => {
    setScanning(false);
    if (router?.place(id)) { setFromId(id); setNotice(null); track('qr_scan', { place: id, source: 'in_app' }); }
    else setNotice('That QR code points to a place that is no longer on this map. Choose where you are.');
  }, [router]);

  useEffect(() => {
    if (!venue || initial.page !== 'map') return;
    const q = new URLSearchParams();
    if (fromId) q.set('from', fromId);
    if (toId) q.set('to', toId);
    if (profile !== 'standard') q.set('profile', profile);
    const qs = q.toString();
    history.replaceState(null, '', `/v/${venue.id}${qs ? `?${qs}` : ''}`);
    try { localStorage.setItem('navcon.profile', profile); } catch { /* private mode */ }
  }, [venue, fromId, toId, profile, initial.page]);

  const outcome = useMemo<(RouteOutcome & { ms: number }) | null>(() => {
    if (!router || !from || !to) return null;
    if (from.id === to.id) return { ok: false, reason: 'The start and the destination are the same place.', ms: 0 };
    const t0 = performance.now();
    const r = router.route(from.id, to.id, profile);
    return { ...r, ms: performance.now() - t0 };
  }, [router, from, to, profile]);

  useEffect(() => {
    if (!outcome || !from || !to) return;
    if (outcome.ok) {
      track(hadRoute.current ? 'route_updated' : 'route_requested', { from: from.id, to: to.id, profile, meters: Math.round(outcome.route.meters), compute_ms: Math.round(outcome.ms) });
      hadRoute.current = true;
    } else {
      track('route_failed', { from: from.id, to: to.id, profile, reason: outcome.reason });
    }
  }, [outcome, from, to, profile]);

  if (loadError) return <main className="center"><p>{loadError}</p><button className="primary" onClick={() => location.reload()}>Try again</button></main>;
  if (!venue || !router) return <main className="center" aria-busy="true"><p>Loading the venue…</p></main>;

  if (initial.page === 'qr') {
    return <Suspense fallback={<main className="center"><p>Loading…</p></main>}><QrSheet venue={venue} places={router.places} /></Suspense>;
  }

  const route = outcome?.ok ? outcome.route : null;
  const quick = QUICK.map((id) => router.place(id)).filter((p): p is Place => !!p);
  const pick = (p: Place) => {
    if (picking === 'from') setFromId(p.id); else setToId(p.id);
    setPicking(null);
    setNotice(null);
  };

  return (
    <div className="app">
      <header className="top brand">
        <img src="/icon.svg" alt="" width={22} height={22} />
        <strong>Navcon</strong>
        <span className="venue"><span className="venue-chip" title={venue.name}><IconPin size={13} />{venue.name}</span></span>
        {RADAR_KEY && venue.geo && <button className="link-btn" onClick={() => setArriving(true)}><IconPin size={16} />Getting here</button>}
      </header>

      <MapView venue={venue} route={route} from={from} to={to}>
        <ProfileMenu profile={profile} onChange={setProfile} />
      </MapView>

      <section className={collapsed && route ? 'panel is-collapsed' : 'panel'} aria-label="Plan a route">
        {route && (
          <button
            className="grabber"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show the route plan and directions' : 'Hide the route plan to see more of the map'}
            onClick={() => { if (dragged.current) { dragged.current = false; return; } setCollapsed((c) => !c); }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragY.current = e.clientY; dragged.current = false; }}
            onPointerMove={(e) => {
              if (dragY.current === null) return;
              const dy = e.clientY - dragY.current;
              if (Math.abs(dy) > 24) { setCollapsed(dy > 0); dragY.current = null; dragged.current = true; }
            }}
            onPointerUp={() => { dragY.current = null; }}
            onPointerCancel={() => { dragY.current = null; }}
          ><span aria-hidden="true" /></button>
        )}
        {collapsed && route && (
          <button className="peek" onClick={() => setCollapsed(false)}>
            <strong>{feet(route.meters)} ft</strong>
            <span className="sum-time">about {Math.max(1, Math.round(route.seconds / 60))} min</span>
            <span className="peek-to">to {route.to.title}</span>
          </button>
        )}
        <div className="plan">
          <div className="fields">
            <div className="field-stack">
              <div className="field-row">
                <button className="field" onClick={() => setPicking('from')}>
                  <span className="tag tag-from" aria-hidden="true">A</span>
                  <span className="f-label">From</span>
                  <span className={from ? 'f-value' : 'f-value empty'}>{from ? from.title : 'Where are you?'}</span>
                </button>
                <button className="scan-btn" onClick={() => setScanning(true)} aria-label="Scan a booth’s QR code to set where you are"><IconQr /></button>
              </div>
              <button className="field" onClick={() => setPicking('to')}>
                <span className="tag tag-to" aria-hidden="true">B</span>
                <span className="f-label">To</span>
                <span className={to ? 'f-value' : 'f-value empty'}>{to ? to.title : 'Where to?'}</span>
              </button>
            </div>
            <button className="swap" onClick={() => { setFromId(toId); setToId(fromId); }} disabled={!from && !to} aria-label="Swap start and destination"><IconSwap /></button>
          </div>

          {!online && <p className="banner"><IconOffline />You are offline. Routes still work; search matches names and booth numbers only.</p>}
          {notice && <p className="banner" role="status">{notice}</p>}
        </div>

        <div className="directions" aria-live="polite">
          {route ? (
            <>
              <p className="summary">
                <span className="sum-main"><strong>{feet(route.meters)} ft</strong><span className="sum-time">about {Math.max(1, Math.round(route.seconds / 60))} min</span></span>
                <span className="sum-meta">{Math.round(route.meters)} m · {PROFILE_LABEL[route.profile]} route</span>
              </p>
              <ol className="steps">{route.steps.map((s, i) => <li key={i}>{s.text}</li>)}</ol>
              <p className="hint">Passing another booth? Scan its QR code to update where you are.</p>
            </>
          ) : outcome && !outcome.ok ? (
            <p className="summary alert" role="alert">{outcome.reason}</p>
          ) : null}
        </div>
      </section>

      {scanning && (
        <Suspense fallback={null}>
          <ScanSheet venueId={venue.id} onScan={onScan} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      {arriving && RADAR_KEY && (
        <Suspense fallback={null}>
          <ArrivalSheet venue={venue} apiKey={RADAR_KEY} onClose={() => setArriving(false)} onStartAtEntrance={() => { setFromId('main-entrance'); setArriving(false); }} />
        </Suspense>
      )}

      {picking && (
        <SearchSheet
          venueId={venue.id}
          places={router.places}
          title={picking === 'from' ? 'Where are you?' : 'Where to?'}
          quick={quick}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
