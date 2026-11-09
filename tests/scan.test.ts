import { describe, expect, it } from 'vitest';
import { parseNavconQr } from '../src/ui/ScanSheet';

describe('in-app QR scanner', () => {
  it('reads the start from a booth code for this venue', () => {
    expect(parseNavconQr('https://navcon.vercel.app/v/kcna26?from=b134&src=qr', 'kcna26')).toEqual({ id: 'b134' });
  });
  it('accepts a code printed from another host of the same app', () => {
    expect(parseNavconQr('https://lunzerr.cnh.radarhq.io/v/kcna26?from=demo-theater&src=qr', 'kcna26')).toEqual({ id: 'demo-theater' });
  });
  it('refuses codes for another venue, codes with no start, and anything that is not a link', () => {
    expect(parseNavconQr('https://navcon.vercel.app/v/other?from=b1', 'kcna26')).toHaveProperty('error');
    expect(parseNavconQr('https://navcon.vercel.app/v/kcna26', 'kcna26')).toHaveProperty('error');
    expect(parseNavconQr('https://example.com/?from=b134', 'kcna26')).toHaveProperty('error');
    expect(parseNavconQr('WIFI:S:conference;T:WPA;P:secret;;', 'kcna26')).toHaveProperty('error');
  });
});
