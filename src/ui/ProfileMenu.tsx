import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../routing/grid';

const OPTIONS: { id: Profile; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'The shortest walkable route' },
  { id: 'nostairs', label: 'No stairs', hint: 'Avoids stairs' },
  { id: 'wheelchair', label: 'Wheelchair', hint: 'Step-free, with extra clearance' },
];

const IconWalk = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.500-1-4.300-2.400l-1-1.600c-.4-.6-1-1-1.700-1-.3 0-.5.100-.8.100L6 8.300V13h2V9.600l1.800-.7" />
  </svg>
);
const IconNoStairs = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19h4v-4h4v-4h4V7h4" /><path d="M4 5l16 16" />
  </svg>
);
const IconWheelchair = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="4" r="2" />
    <path d="M19 13v-2c-1.540.020-3.090-.750-4.070-1.830l-1.290-1.430c-.170-.190-.380-.340-.610-.450-.010 0-.010-.010-.020-.010H13c-.350-.2-.750-.3-1.190-.260C10.760 7.110 10 8.040 10 9.090V15c0 1.100.9 2 2 2h5v5h2v-5.500c0-1.100-.9-2-2-2h-3v-3.450c1.290 1.070 3.250 1.940 5 1.950zm-6.170 5c-.410 1.160-1.520 2-2.830 2-1.660 0-3-1.340-3-3 0-1.310.840-2.410 2-2.830V12.100a5 5 0 1 0 5.900 5.900h-2.070z" />
  </svg>
);
const IconCheck = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.500 4.500L19 7.500" />
  </svg>
);
const ICON: Record<Profile, () => JSX.Element> = { standard: IconWalk, nostairs: IconNoStairs, wheelchair: IconWheelchair };

interface Props { profile: Profile; onChange: (p: Profile) => void }

/**
 * Route type as a floating button on the map. Pressing it opens a small menu; choosing an
 * option closes the menu and, for anything other than Standard, leaves a badge on the button
 * so the choice stays visible without taking space in the sheet.
 */
export function ProfileMenu({ profile, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = OPTIONS.find((o) => o.id === profile) ?? OPTIONS[0];
  const Current = ICON[profile === 'standard' ? 'wheelchair' : profile];

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); };
  }, [open]);

  const choose = (p: Profile) => { onChange(p); setOpen(false); button.current?.focus(); };
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    // Stop the map underneath from treating a press here as the start of a pan.
    <div className="profile" ref={root} onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="profile-menu" role="menu" aria-label="Route type" onKeyDown={arrows}>
          <p className="profile-title">Route type</p>
          {OPTIONS.map((o) => {
            const Icon = ICON[o.id];
            const on = o.id === profile;
            return (
              <button key={o.id} role="menuitemradio" aria-checked={on} className={on ? 'is-on' : undefined} onClick={() => choose(o.id)}>
                <span className="profile-ico"><Icon /></span>
                <span className="profile-text"><strong>{o.label}</strong><span>{o.hint}</span></span>
                <span className="profile-check">{on && <IconCheck />}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        ref={button}
        className={profile === 'standard' ? 'profile-fab' : 'profile-fab is-set'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Route type: ${current.label}. Change route type`}
        onClick={() => setOpen((v) => !v)}
      >
        <Current />
        {profile !== 'standard' && <span className="profile-badge" aria-hidden="true"><IconCheck size={11} /></span>}
      </button>
    </div>
  );
}
