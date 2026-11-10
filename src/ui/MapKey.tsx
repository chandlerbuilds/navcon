import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VenueBundle } from '../venue/types';

/** Sponsorship levels in the order the organizers' map lists them. */
const TIERS: [string, string][] = [
  ['diamond', 'Diamond'], ['platinum', 'Platinum'], ['gold', 'Gold'], ['silver', 'Silver'],
  ['startup', 'Start-up'], ['enduser', 'End user'], ['media', 'Media partner'],
];

const IconKey = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.500" y="4" width="5" height="5" rx="1" /><path d="M12 6.500h8.500" />
    <rect x="3.500" y="15" width="5" height="5" rx="2.500" /><path d="M12 17.500h8.500" />
  </svg>
);

/**
 * The map key, opened from a round button beside the route-type button. Two lists:
 * booth colour means sponsorship level, and floor colour means the named zone, which is
 * also what the large signs in each part of the hall say.
 */
export function MapKey({ venue }: { venue: VenueBundle }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<React.CSSProperties>({ right: 12, bottom: 120 });
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tiers = TIERS.filter(([id]) => venue.tiers[id]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !card.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="profile map-key" ref={root} onPointerDown={(e) => e.stopPropagation()}>
      {open && createPortal(
        <div ref={card} className="profile-menu key-card" role="dialog" aria-label="Map key" style={at}>
          <p className="profile-title">Booth colour: sponsorship level</p>
          <ul className="key-list">
            {tiers.map(([id, label]) => <li key={id}><span className="key-swatch key-booth" style={{ background: venue.tiers[id] }} />{label}</li>)}
          </ul>
          <p className="profile-title">Floor colour: zone (as on the signs)</p>
          <ul className="key-list">
            {venue.zones.map((z) => <li key={z.id}><span className="key-swatch" style={{ background: z.color }} />{z.name}</li>)}
          </ul>
        </div>,
        document.body,
      )}
      <button
        ref={button}
        className="profile-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Map key: what the colours mean"
        onClick={() => {
          const r = button.current!.getBoundingClientRect();
          const right = Math.max(8, window.innerWidth - r.right);
          const H = 330;
          if (r.top - 8 - H >= 8) setAt({ right, bottom: window.innerHeight - r.top + 8 });
          else setAt({ right, top: Math.max(8, Math.min(r.bottom + 8, window.innerHeight - H - 8)) });
          setOpen((v) => !v);
        }}
      >
        <IconKey />
      </button>
    </div>
  );
}
