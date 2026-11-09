import { useEffect, useRef, useState } from 'react';
import { loadRadar } from '../radar';
import { IconBack } from './icons';
import type { VenueBundle } from '../venue/types';

interface Props { venue: VenueBundle; apiKey: string; onClose: () => void; onStartAtEntrance: () => void }

/**
 * "Getting here": a Radar map of the venue, a geofence check that tells you whether
 * you are already on site, and the walking time to the venue if you are not.
 * Location is asked for only when the person taps the button.
 */
export default function ArrivalSheet({ venue, apiKey, onClose, onStartAtEntrance }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void; flyTo: (o: object) => void } | null>(null);
  const venueAt = useRef<[number, number]>([venue.geo!.lng, venue.geo!.lat]);
  const [status, setStatus] = useState('Loading the map…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const Radar = await loadRadar(apiKey);
        // Radar geocoding turns the venue's street address into a map position.
        try {
          const geo = await Radar.forwardGeocode({ query: `${venue.geo!.place}, ${venue.geo!.address}` });
          const hit = geo.addresses?.[0];
          if (hit?.latitude && hit?.longitude) venueAt.current = [hit.longitude, hit.latitude];
        } catch { /* keep the stored position */ }
        if (!alive || !box.current) return;
        const map = Radar.ui.map({ container: box.current, style: 'radar-default-v1', center: venueAt.current, zoom: 16 });
        Radar.ui.marker({ color: '#1e3a8a', popup: { text: venue.geo!.place } }).setLngLat(venueAt.current).addTo(map);
        mapRef.current = map;
        setStatus(`${venue.geo!.place}, ${venue.geo!.address}`);
      } catch {
        if (alive) setStatus(`The map could not be loaded. The venue is at ${venue.geo!.address}.`);
      }
    })();
    return () => { alive = false; mapRef.current?.remove(); mapRef.current = null; };
  }, [apiKey, venue]);

  const locate = async () => {
    setBusy(true);
    try {
      const Radar = await loadRadar(apiKey);
      const res = await Radar.trackOnce();
      const here = res.location;
      const onSite = (res.user?.geofences ?? []).some((g) => g.tag === 'venue' && g.externalId === venue.id);
      if (onSite) {
        setStatus('You are at the venue. Head for the Main Entrance, then route from there.');
      } else if (here) {
        const d = await Radar.distance({ origin: { latitude: here.latitude, longitude: here.longitude }, destination: { latitude: venueAt.current[1], longitude: venueAt.current[0] }, modes: ['foot'], units: 'imperial' });
        const foot = d.routes.foot;
        setStatus(foot?.duration && foot.distance ? `About ${foot.duration.text} on foot (${foot.distance.text}) to ${venue.geo!.place}.` : `You are not at the venue yet. It is at ${venue.geo!.address}.`);
        Radar.ui.marker({ color: '#0f766e', popup: { text: 'You' } }).setLngLat([here.longitude, here.latitude]).addTo(mapRef.current as never);
      }
    } catch {
      setStatus(`Your location was not available. The venue is at ${venue.geo!.address}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Getting here">
      <div className="sheet-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Back"><IconBack /></button>
        <strong>Getting here</strong>
      </div>
      <div className="arrival-map" ref={box} />
      <div className="arrival-info" aria-live="polite">
        <p>{status}</p>
        <div className="row">
          <button className="primary" onClick={locate} disabled={busy}>{busy ? 'Checking…' : 'Check my location'}</button>
          <button className="ghost" onClick={onStartAtEntrance}>Route from the Main Entrance</button>
        </div>
      </div>
    </div>
  );
}
