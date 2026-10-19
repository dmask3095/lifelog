// Minimum Viable Day toggle, remembered per date in this browser. The server only
// recommends; the human decides. A tiny event keeps the Day and Tasks views in sync.
const KEY = (date: string) => `lifelog.mvd.${date}`;
export const MVD_EVENT = 'lifelog:mvd';

export function getMvd(date: string, recommended: boolean): boolean {
  try {
    const stored = localStorage.getItem(KEY(date));
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch { /* storage unavailable */ }
  return recommended;
}

export function setMvd(date: string, on: boolean) {
  try { localStorage.setItem(KEY(date), on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(MVD_EVENT, { detail: { date, on } }));
}
