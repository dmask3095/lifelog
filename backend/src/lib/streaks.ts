import { shiftDate, daysBetween } from './dates';

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  shields: number;
  totalKept: number;
  consistency14: number;
  history14: Array<{ date: string; tier: string | null }>;
}

const MAX_SHIELDS = 3;
const DAYS_PER_SHIELD = 7;

/**
 * Elastic streak engine.
 *
 * Walks forward from the habit's first day to `today`. Every kept day extends the streak;
 * every 7 consecutive kept days earn one Grace Shield (max 3). A missed day in the past
 * consumes a shield instead of resetting the streak. Today never breaks the streak until
 * it is over. Everything is derived from habit_logs, so it is always consistent.
 */
export function computeStreak(
  keptByDate: Map<string, string>,
  firstDay: string,
  today: string,
  baseShields = 1
): StreakResult {
  const dates = [...keptByDate.keys()].sort();
  let start = firstDay;
  if (dates.length > 0 && dates[0] < start) start = dates[0];
  if (start > today) start = today;

  let streak = 0;
  let longest = 0;
  let shields = Math.min(MAX_SHIELDS, Math.max(0, baseShields));
  let earnRun = 0;
  let totalKept = 0;

  const span = daysBetween(start, today);
  for (let i = 0; i <= span; i++) {
    const d = shiftDate(start, i);
    const kept = keptByDate.has(d);
    if (kept) {
      streak++;
      totalKept++;
      earnRun++;
      if (earnRun >= DAYS_PER_SHIELD) {
        shields = Math.min(MAX_SHIELDS, shields + 1);
        earnRun = 0;
      }
    } else if (d === today) {
      // still pending today: neither extends nor breaks
    } else if (shields > 0) {
      shields--;
      earnRun = 0;
    } else {
      streak = 0;
      earnRun = 0;
    }
    if (streak > longest) longest = streak;
  }

  const history14: Array<{ date: string; tier: string | null }> = [];
  let possible = 0;
  let kept14 = 0;
  for (let i = 13; i >= 0; i--) {
    const d = shiftDate(today, -i);
    const tier = keptByDate.get(d) ?? null;
    history14.push({ date: d, tier });
    if (d >= start) {
      possible++;
      if (tier) kept14++;
    }
  }

  return {
    currentStreak: streak,
    longestStreak: longest,
    shields,
    totalKept,
    consistency14: possible > 0 ? Math.round((kept14 / possible) * 100) : 0,
    history14,
  };
}
