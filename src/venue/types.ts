export type Pt = [number, number];

export interface Booth { id: string; number: string; name: string | null; tier: string; poly: Pt[] }
export interface Area { id: string; name: string; kind: string; poly: Pt[] }
export interface PointPlace { id: string; name: string; kind: string; at: Pt }
export interface Zone { id: string; name: string; color: string; poly: Pt[] }

/** One published venue version: everything a phone needs to draw the map and route offline. */
export interface VenueBundle {
  id: string;
  name: string;
  subtitle: string;
  version: number;
  scaleNote: string;
  geo?: { place: string; address: string; lat: number; lng: number };
  size: Pt;
  outline: Pt[];
  zones: Zone[];
  tiers: Record<string, string>;
  booths: Booth[];
  areas: Area[];
  points: PointPlace[];
}

/** Anything a person can search for and route to. */
export interface Place {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  number?: string;
  center: Pt;
  poly?: Pt[];
}

const TIER_LABEL: Record<string, string> = {
  diamond: 'Diamond', platinum: 'Platinum', gold: 'Gold', silver: 'Silver',
  startup: 'Start-up', enduser: 'End user', media: 'Media partner', feature: 'Feature',
};
const KIND_LABEL: Record<string, string> = {
  seating: 'Seating', food: 'Food and drink', service: 'Service', stage: 'Stage', pavilion: 'Pavilion',
  lounge: 'Lounge', restroom: 'Restroom', entrance: 'Entrance', hall: 'Hall', zone: 'Zone',
};

export function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

export function placesOf(v: VenueBundle): Place[] {
  const out: Place[] = [];
  for (const b of v.booths) {
    out.push({
      id: b.id, kind: 'booth', number: b.number,
      title: b.name ?? `Booth ${b.number}`,
      subtitle: `Booth ${b.number} · ${TIER_LABEL[b.tier] ?? b.tier}`,
      center: centroid(b.poly), poly: b.poly,
    });
  }
  for (const a of v.areas) {
    out.push({ id: a.id, kind: a.kind, title: a.name, subtitle: KIND_LABEL[a.kind] ?? a.kind, center: centroid(a.poly), poly: a.poly });
  }
  for (const p of v.points) {
    out.push({ id: p.id, kind: p.kind, title: p.name, subtitle: KIND_LABEL[p.kind] ?? p.kind, center: p.at });
  }
  return out;
}
