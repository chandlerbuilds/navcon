import type RadarSdk from 'radar-sdk-js';

let sdk: Promise<typeof RadarSdk> | null = null;

/** Radar is loaded only when someone opens "Getting here", so the floor map stays light and offline-safe. */
export function loadRadar(publishableKey: string): Promise<typeof RadarSdk> {
  if (!sdk) {
    sdk = (async () => {
      const [{ default: Radar }, { createMapsPlugin }] = await Promise.all([
        import('radar-sdk-js'),
        import('@radarlabs/plugin-maps'),
        import('@radarlabs/plugin-maps/dist/radar-maps.css'),
      ]);
      Radar.registerPlugin(createMapsPlugin());
      Radar.initialize(publishableKey);
      return Radar;
    })();
  }
  return sdk;
}
