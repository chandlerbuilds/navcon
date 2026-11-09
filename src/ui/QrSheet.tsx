import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { norm } from '../search/local';
import type { Place, VenueBundle } from '../venue/types';

function Qr({ url, size }: { url: string; size: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => { if (alive) setSvg(s); });
    return () => { alive = false; };
  }, [url]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Printable QR codes: one for the app, one per place. A plain link, so any phone camera opens it. */
export default function QrSheet({ venue, places }: { venue: VenueBundle; places: Place[] }) {
  const [filter, setFilter] = useState('');
  const base = `${location.origin}/v/${venue.id}`;
  const shown = useMemo(() => {
    const q = norm(filter);
    const list = places.filter((p) => p.kind !== 'hall' && p.kind !== 'zone');
    return q ? list.filter((p) => norm(`${p.title} ${p.number ?? ''}`).includes(q)) : list;
  }, [places, filter]);
  return (
    <main className="qr-page">
      <header className="no-print">
        <a href={`/v/${venue.id}`}>← Back to the map</a>
        <h1>QR codes for {venue.name}</h1>
        <p>Post each code at its booth or landmark. Scanning one opens Navcon with that place as the start.</p>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or booth number" aria-label="Filter" />
        <button className="primary" onClick={() => print()}>Print {shown.length + 1} codes</button>
      </header>
      <div className="qr-grid">
        <figure className="qr-card">
          <Qr url={base} size={150} />
          <figcaption><strong>Open Navcon</strong><span>{base.replace(/^https?:\/\//, '')}</span></figcaption>
        </figure>
        {shown.map((p) => (
          <figure className="qr-card" key={p.id}>
            <Qr url={`${base}?from=${p.id}&src=qr`} size={150} />
            <figcaption><strong>{p.title}</strong><span>{p.kind === 'booth' ? `Booth ${p.number}` : p.subtitle} · You are here</span></figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
