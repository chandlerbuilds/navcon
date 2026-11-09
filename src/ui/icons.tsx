/** A few line icons drawn on one 24-unit grid with one stroke weight, so every control speaks the same language. */
type P = { size?: number };

const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconSwap = ({ size = 20 }: P) => svg(size, <><path d="M7 4v16" /><path d="m3 8 4-4 4 4" /><path d="M17 20V4" /><path d="m21 16-4 4-4-4" /></>);
export const IconBack = ({ size = 22 }: P) => svg(size, <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>);
export const IconClose = ({ size = 20 }: P) => svg(size, <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>);
export const IconPlus = ({ size = 20 }: P) => svg(size, <><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconMinus = ({ size = 20 }: P) => svg(size, <path d="M5 12h14" />);
export const IconFit = ({ size = 20 }: P) => svg(size, <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>);
export const IconSearch = ({ size = 18 }: P) => svg(size, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconPin = ({ size = 18 }: P) => svg(size, <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>);
export const IconOffline = ({ size = 16 }: P) => svg(size, <><path d="M2 8.8a15 15 0 0 1 4.2-2.6" /><path d="M10.7 5.1A15 15 0 0 1 22 8.8" /><path d="M5 12.6a10 10 0 0 1 3-1.9" /><path d="M15.5 11a10 10 0 0 1 3.5 1.6" /><path d="M8.5 16.4a5 5 0 0 1 7 0" /><circle cx="12" cy="20" r="0.6" fill="currentColor" /><path d="m3 3 18 18" /></>);
export const IconQr = ({ size = 20 }: P) => svg(size, <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3" /><path d="M21 14v.01" /><path d="M14 21h.01" /><path d="M17.5 21H21v-3.5" /></>);
