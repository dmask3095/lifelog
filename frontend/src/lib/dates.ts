const DAY_MS = 86_400_000;

// Built from local getters on purpose: toISOString() rolls "today" back a day for
// anyone ahead of UTC during the early hours of the local day.
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const t = Date.parse(date + 'T00:00:00Z') + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}

export function weekdayShort(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
}

export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

export function formatLong(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShort(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function relativeLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return formatShort(date);
}

export function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
