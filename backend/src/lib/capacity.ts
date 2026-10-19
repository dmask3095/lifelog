export interface CapacityInput {
  sleepMinutes: number | null;
  moodScore: number | null;
  waterMl: number | null;
}

export interface Capacity {
  score: number | null;
  level: 'unknown' | 'recovery' | 'steady' | 'peak';
  mvdRecommended: boolean;
  signals: { sleep: boolean; mood: boolean; water: boolean };
  parts: { sleep: number | null; mood: number | null; water: number | null };
  headline: string;
}

const WEIGHTS = { sleep: 0.45, mood: 0.35, water: 0.2 };
export const MVD_THRESHOLD = 65;

/**
 * Daily Capacity: how much of a "full day" the body is actually ready for.
 * 7.5h sleep, a 5/5 mood and 2L water each score 100. Missing signals are
 * excluded and the remaining weights are renormalised, so the score is never
 * dragged down by things that simply were not logged yet.
 */
export function computeCapacity(input: CapacityInput): Capacity {
  const parts = {
    sleep: input.sleepMinutes != null && input.sleepMinutes > 0 ? Math.min(100, Math.round((input.sleepMinutes / 450) * 100)) : null,
    mood: input.moodScore != null ? Math.min(100, Math.max(0, input.moodScore * 20)) : null,
    water: input.waterMl != null && input.waterMl > 0 ? Math.min(100, Math.round((input.waterMl / 2000) * 100)) : null,
  };
  const signals = { sleep: parts.sleep != null, mood: parts.mood != null, water: parts.water != null };

  let weightSum = 0;
  let acc = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    const v = parts[k];
    if (v != null) {
      acc += v * WEIGHTS[k];
      weightSum += WEIGHTS[k];
    }
  });

  if (weightSum === 0 || (!signals.sleep && !signals.mood)) {
    return {
      score: null,
      level: 'unknown',
      mvdRecommended: false,
      signals,
      parts,
      headline: 'Log last night’s sleep or a mood check-in to unlock today’s capacity.',
    };
  }

  const score = Math.round(acc / weightSum);
  const level: Capacity['level'] = score < MVD_THRESHOLD ? 'recovery' : score < 85 ? 'steady' : 'peak';
  const headline =
    level === 'recovery'
      ? 'Low-capacity day. Minimum Viable Day mode keeps the streak alive without the guilt.'
      : level === 'steady'
        ? 'Steady day. Protect one deep-work block and keep the rest light.'
        : 'Peak day. Front-load the hardest task while the tank is full.';

  return { score, level, mvdRecommended: level === 'recovery', signals, parts, headline };
}
