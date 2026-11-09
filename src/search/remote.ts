/**
 * Elasticsearch-backed search through our own API function.
 * Returns place ids, or null when the service is unreachable or not configured,
 * in which case the caller falls back to the on-device search.
 */
let downUntil = 0;

export async function searchRemote(venue: string, q: string, signal: AbortSignal): Promise<string[] | null> {
  if (!navigator.onLine || Date.now() < downUntil) return null;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 1500);
  signal.addEventListener('abort', () => timeout.abort(), { once: true });
  try {
    const res = await fetch(`/api/search?venue=${encodeURIComponent(venue)}&q=${encodeURIComponent(q)}`, { signal: timeout.signal });
    if (!res.ok) {
      if (res.status !== 429) downUntil = Date.now() + 60_000;
      return null;
    }
    const body = (await res.json()) as { ids?: string[]; configured?: boolean };
    if (body.configured === false) downUntil = Date.now() + 5 * 60_000;
    return Array.isArray(body.ids) ? body.ids : null;
  } catch {
    if (!signal.aborted) downUntil = Date.now() + 15_000;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
