import { useEffect, useMemo, useRef, useState } from 'react';
import { searchLocal } from '../search/local';
import { searchRemote } from '../search/remote';
import { track } from '../telemetry';
import { IconBack, IconClose, IconSearch } from './icons';
import type { Place } from '../venue/types';

interface Props {
  venueId: string;
  places: Place[];
  title: string;
  quick: Place[];
  onPick: (p: Place) => void;
  onClose: () => void;
}

export function SearchSheet({ venueId, places, title, quick, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<{ q: string; hits: Place[] } | null>(null);
  const [limited, setLimited] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const local = useMemo(() => searchLocal(places, q), [places, q]);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setRemote(null); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      const ids = await searchRemote(venueId, query, ctl.signal);
      if (ctl.signal.aborted) return;
      // Record what the attendee was shown: the service's results, or the on-device ones when
      // the service is down or found nothing (the same rule as `results` below).
      const report = (source: 'elasticsearch' | 'device', results: number) =>
        track(results ? 'search' : 'search_no_results', { query_length: query.length, results, source });
      if (ids === null) { setLimited(true); setRemote(null); report('device', local.length); return; }
      setLimited(false);
      const hits = ids.map((id) => byId.get(id)).filter((p): p is Place => !!p);
      setRemote({ q: query, hits });
      if (hits.length) report('elasticsearch', hits.length);
      else report('device', local.length);
    }, 220);
    return () => { ctl.abort(); clearTimeout(timer); };
  }, [q, venueId, byId, local]);

  // Show on-device results at once; swap in the service's ranking when it answers for this query.
  const results = remote && remote.q === q.trim() && remote.hits.length ? remote.hits : local;
  const empty = q.trim().length >= 2 && results.length === 0;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Back"><IconBack /></button>
        <label className="search-box">
          <IconSearch />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Booth number, company or landmark"
            aria-label={title}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0]); if (e.key === 'Escape') onClose(); }}
          />
          {q && <button type="button" className="clear-btn" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear"><IconClose size={16} /></button>}
        </label>
      </div>
      {limited && q.trim().length >= 2 && <p className="note limited">Limited search: matching names and booth numbers on this device.</p>}
      {!q.trim() && <p className="list-head">Popular places</p>}
      <ul className="results">
        {(q.trim() ? results : quick).map((p) => (
          <li key={p.id}>
            <button onClick={() => onPick(p)}>
              <span className="r-title">{p.title}</span>
              <span className="r-sub">{p.subtitle}</span>
            </button>
          </li>
        ))}
      </ul>
      {empty && <p className="note">Nothing matches “{q.trim()}”. Try a booth number or the start of a company name.</p>}
      {!q.trim() && <p className="note">Type a booth number (134), a company (Dash0) or a landmark (restroom).</p>}
    </div>
  );
}
