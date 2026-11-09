import { init, sendEvent } from '@dash0/sdk-web';

// Dash0 website monitoring. The token is an ingest-only key meant for browsers;
// it is injected at build time and never committed.
const url = import.meta.env.VITE_DASH0_ENDPOINT as string | undefined;
const token = import.meta.env.VITE_DASH0_TOKEN as string | undefined;
let enabled = false;

export function initTelemetry(): void {
  if (!url || !token) return;
  try {
    init({
      serviceName: 'navcon-pwa',
      // Lets the dashboard separate local runs from real use, and the Vercel site
      // (and its previews) from the cluster copy.
      environment: import.meta.env.MODE,
      deploymentName: location.hostname,
      endpoint: { url, authToken: token },
    });
    enabled = true;
  } catch (err) {
    console.warn('telemetry disabled', err);
  }
}

type Attrs = Record<string, string | number | boolean>;

/** Custom navigation events. Place ids only: nothing about the person. */
export function track(name: 'qr_scan' | 'search' | 'search_no_results' | 'route_requested' | 'route_failed' | 'route_updated', attributes: Attrs = {}): void {
  if (!enabled) return;
  try {
    sendEvent(name, { attributes });
  } catch {
    /* never let telemetry break navigation */
  }
}
