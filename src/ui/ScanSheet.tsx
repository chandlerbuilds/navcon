import { useEffect, useRef, useState } from 'react';
import { IconBack } from './icons';

interface Props {
  venueId: string;
  /** Called with the place id from a Navcon QR code for this venue. */
  onScan: (placeId: string) => void;
  onClose: () => void;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Reads a booth's QR code with the phone's camera and hands back the place it names.
 * The code is only parsed, never opened: anything that is not a Navcon link for this venue is refused.
 */
export function parseNavconQr(text: string, venueId: string): { id: string } | { error: string } {
  let url: URL;
  try { url = new URL(text); } catch { return { error: 'That QR code is not a Navcon code. Scan the code posted at a booth.' }; }
  const parts = url.pathname.split('/').filter(Boolean);
  const from = url.searchParams.get('from');
  if (parts[0] !== 'v' || !parts[1] || !from) return { error: 'That QR code is not a Navcon booth code. Scan the code posted at a booth.' };
  if (parts[1] !== venueId) return { error: 'That QR code is for a different venue.' };
  return { id: from };
}

export default function ScanSheet({ venueId, onScan, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting the camera…');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setFailed(true);
        setStatus('This browser cannot use the camera here. Scan the booth’s code with your phone’s camera app instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        if (!alive) return;
        setFailed(true);
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setStatus(denied
          ? 'Camera access is blocked. Allow it in your browser settings, or scan the booth’s code with your phone’s camera app.'
          : 'No camera is available. Scan the booth’s code with your phone’s camera app instead.');
        return;
      }
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setStatus('Point the camera at the QR code on a booth.');

      // Native detector where the browser has one (Chrome on Android); jsQR everywhere else (Safari on iPhone).
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = Native ? new Native({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      let busy = false;

      const tick = async () => {
        if (!alive) return;
        raf = requestAnimationFrame(tick);
        if (busy || v.readyState < 2 || !v.videoWidth) return;
        busy = true;
        try {
          let text: string | undefined;
          if (native) {
            text = (await native.detect(v))[0]?.rawValue;
          } else if (jsQR && ctx) {
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
          }
          if (text && alive) {
            const hit = parseNavconQr(text, venueId);
            if ('id' in hit) { alive = false; cancelAnimationFrame(raf); navigator.vibrate?.(30); onScan(hit.id); return; }
            setStatus(hit.error);
          }
        } catch { /* a frame that cannot be read; try the next one */ }
        busy = false;
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => { alive = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [venueId, onScan]);

  return (
    <div className="sheet scan" role="dialog" aria-modal="true" aria-label="Scan a booth’s QR code">
      <div className="sheet-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Back"><IconBack /></button>
        <strong>Scan a booth’s QR code</strong>
      </div>
      <div className="scan-view">
        <video ref={video} playsInline muted />
        {!failed && <span className="scan-frame" aria-hidden="true" />}
      </div>
      <p className={failed ? 'scan-status failed' : 'scan-status'} role="status">{status}</p>
    </div>
  );
}
