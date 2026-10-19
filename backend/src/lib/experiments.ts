import type { DbHandle } from '../database';
import { loadDayPoints } from './series';
import { shiftDate, daysBetween } from './dates';

export interface ExperimentRow {
  id: number;
  user_id: number;
  title: string;
  cause_kind: 'habit' | 'time' | 'tag';
  cause_ref: string;
  cause_min: number;
  effect: 'mood' | 'productivity' | 'sleep' | 'deep_work';
  start_date: string;
  days: number;
  status: string;
  created_at: string;
}

export interface ExperimentResult {
  daysElapsed: number;
  daysTotal: number;
  endDate: string;
  withN: number;
  withoutN: number;
  withMean: number | null;
  withoutMean: number | null;
  diff: number | null;
  unit: string;
  verdict: 'collecting' | 'supported' | 'not_supported' | 'no_difference' | 'inconclusive';
  summary: string;
  causeLabel: string;
  effectLabel: string;
}

const EFFECT_META: Record<ExperimentRow['effect'], { label: string; unit: string; threshold: number; fmt: (v: number) => string; lag: boolean }> = {
  mood: { label: 'mood', unit: '/5', threshold: 0.4, fmt: (v) => v.toFixed(1) + '/5', lag: false },
  productivity: { label: 'task completion', unit: '%', threshold: 10, fmt: (v) => Math.round(v) + '%', lag: false },
  sleep: { label: 'sleep the following night', unit: 'h', threshold: 0.4, fmt: (v) => v.toFixed(1) + 'h', lag: true },
  deep_work: { label: 'deep work', unit: 'min', threshold: 20, fmt: (v) => Math.round(v) + 'm', lag: false },
};

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// Harm hypotheses ("does caffeine hurt my sleep?") expect the effect to be LOWER on cause days.
export function expectsLower(exp: Pick<ExperimentRow, 'cause_kind' | 'cause_ref'>): boolean {
  if (exp.cause_kind === 'tag') return ['caffeine', 'sugar', 'alcohol', 'junk'].includes(exp.cause_ref);
  if (exp.cause_kind === 'time') return exp.cause_ref === 'wasted';
  return false;
}

export async function evaluateExperiment(db: DbHandle, exp: ExperimentRow, today: string): Promise<ExperimentResult> {
  const plannedEnd = shiftDate(exp.start_date, exp.days - 1);
  const end = plannedEnd < today ? plannedEnd : today;
  const meta = EFFECT_META[exp.effect];
  // For lagged effects (sleep), we need the day after the last cause day.
  const seriesEnd = meta.lag ? shiftDate(end, 1) : end;
  const { days } = await loadDayPoints(db, exp.user_id, exp.start_date, seriesEnd);
  const byDate = new Map(days.map((d) => [d.date, d]));

  let causeDays = new Set<string>();
  let causeLabel = exp.cause_ref;
  if (exp.cause_kind === 'habit') {
    const habit = await db.get<any>('SELECT name, icon FROM habits WHERE id = ? AND user_id = ?', exp.cause_ref, exp.user_id);
    causeLabel = habit ? `${habit.icon} ${habit.name}` : 'a habit';
    const rows = await db.all<any>(
      'SELECT date FROM habit_logs WHERE user_id = ? AND habit_id = ? AND completed = 1 AND date BETWEEN ? AND ?',
      exp.user_id, exp.cause_ref, exp.start_date, end
    );
    causeDays = new Set(rows.map((r: any) => r.date));
  } else if (exp.cause_kind === 'time') {
    causeLabel = `${exp.cause_min}m+ ${exp.cause_ref.replace('_', ' ')}`;
    const rows = await db.all<any>(
      'SELECT date, SUM(minutes) AS m FROM time_logs WHERE user_id = ? AND category = ? AND date BETWEEN ? AND ? GROUP BY date',
      exp.user_id, exp.cause_ref, exp.start_date, end
    );
    causeDays = new Set(rows.filter((r: any) => Number(r.m) >= Math.max(1, exp.cause_min)).map((r: any) => r.date));
  } else {
    causeLabel = `${exp.cause_ref} days`;
    const rows = await db.all<any>(
      'SELECT date, tags FROM health_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC, created_at ASC, id ASC',
      exp.user_id, exp.start_date, end
    );
    const latest = new Map<string, string>();
    for (const r of rows) latest.set(r.date, r.tags ?? '');
    causeDays = new Set([...latest.entries()].filter(([, t]) => t.split(',').map((x) => x.trim()).includes(exp.cause_ref)).map(([d]) => d));
  }

  const withVals: number[] = [];
  const withoutVals: number[] = [];
  const span = daysBetween(exp.start_date, end);
  for (let i = 0; i <= span; i++) {
    const d = shiftDate(exp.start_date, i);
    const point = byDate.get(d);
    if (!point || !point.logged) continue;
    const effectDay = meta.lag ? byDate.get(shiftDate(d, 1)) : point;
    if (!effectDay) continue;
    let v: number | null = null;
    if (exp.effect === 'mood') v = effectDay.mood;
    else if (exp.effect === 'productivity') v = effectDay.productivity;
    else if (exp.effect === 'sleep') v = effectDay.sleepMinutes != null ? effectDay.sleepMinutes / 60 : null;
    else v = effectDay.logged ? effectDay.deepWorkMin : null;
    if (v == null) continue;
    (causeDays.has(d) ? withVals : withoutVals).push(v);
  }

  const withMean = mean(withVals);
  const withoutMean = mean(withoutVals);
  const diff = withMean != null && withoutMean != null ? withMean - withoutMean : null;
  const daysElapsed = Math.min(exp.days, daysBetween(exp.start_date, today) + 1);
  const complete = today >= plannedEnd;

  let verdict: ExperimentResult['verdict'] = 'collecting';
  let summary = `Collecting: ${withVals.length} day${withVals.length === 1 ? '' : 's'} with ${causeLabel}, ${withoutVals.length} without. Need at least 3 of each.`;
  if (withVals.length >= 3 && withoutVals.length >= 3 && diff != null) {
    const lower = expectsLower(exp);
    const signedDiff = lower ? -diff : diff; // positive = hypothesis direction
    if (signedDiff >= meta.threshold) {
      verdict = 'supported';
      summary = `Supported so far: ${meta.label} averages ${meta.fmt(withMean as number)} with ${causeLabel} vs ${meta.fmt(withoutMean as number)} without (${withVals.length} vs ${withoutVals.length} days).`;
    } else if (signedDiff <= -meta.threshold) {
      verdict = 'not_supported';
      summary = `Not supported: ${meta.label} is actually ${meta.fmt(withMean as number)} with ${causeLabel} vs ${meta.fmt(withoutMean as number)} without (${withVals.length} vs ${withoutVals.length} days).`;
    } else {
      verdict = 'no_difference';
      summary = `No real difference yet: ${meta.fmt(withMean as number)} with vs ${meta.fmt(withoutMean as number)} without (${withVals.length} vs ${withoutVals.length} days).`;
    }
  } else if (complete) {
    verdict = 'inconclusive';
    summary = `Inconclusive: not enough contrasting days (${withVals.length} with, ${withoutVals.length} without). Try again with a longer window.`;
  }

  return {
    daysElapsed: Math.max(0, daysElapsed),
    daysTotal: exp.days,
    endDate: plannedEnd,
    withN: withVals.length,
    withoutN: withoutVals.length,
    withMean,
    withoutMean,
    diff,
    unit: meta.unit,
    verdict,
    summary,
    causeLabel,
    effectLabel: meta.label,
  };
}
