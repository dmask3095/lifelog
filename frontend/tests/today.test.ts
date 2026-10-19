// Run: npm test (node --test, native type stripping). Pure helpers behind TodayView.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayScore, deferredCount, elapsedSeconds, encouragement, formatClock, formatHour, formatSleep, isFreshAccount,
  lastNightText, moveOptions, onboardingProgress, pickPlan, planStats, sleepMinutesBetween, toMs,
  type DayPlan, type PlanBlock,
} from '../src/components/today/dayPlan.ts';
import type { SummaryData } from '../src/types.ts';

function block(over: Partial<PlanBlock> = {}): PlanBlock {
  return { id: 'b', title: 'Write', energy: 'deep', start: 9, minutes: 60, status: 'planned', ...over };
}
function plan(blocks: PlanBlock[], over: Partial<DayPlan> = {}): DayPlan {
  return { date: '2026-10-19', capacity: 58, capacityKnown: true, level: 'recovery', why: 'x', window: { start: 9, end: 12, source: 'default' }, blocks, deferred: 2, accepted: false, ...over };
}
function summary(over: { tasks?: Partial<SummaryData['tasks']>; habits?: Partial<SummaryData['habits']>; sleep?: number; logged?: number; cap?: number | null } = {}): SummaryData {
  return {
    date: '2026-10-19',
    tasks: { total: 0, completed: 0, ongoing: 0, needsAttention: 0, overdue: 0, productivityScore: 0, items: [], ...over.tasks },
    hurdles: [], time: { byCategory: {}, totalMinutes: 0 },
    health: { totalWater: 0, waterGoalPercent: 0, foodNotes: [], fruits: [], tags: [], healthScore: 0 },
    body: { totalSleepMinutes: over.sleep ?? 0, sleepHours: (over.sleep ?? 0) / 60, sleepPercent: 0, peeCount: 0 },
    mood: null,
    habits: { total: 0, completed: 0, pct: 0, items: [], ...over.habits },
    capacity: { score: over.cap ?? null, level: over.cap == null ? 'unknown' : over.cap < 65 ? 'recovery' : 'steady', mvdRecommended: false, signals: { sleep: !!over.sleep, mood: false, water: false }, parts: { sleep: null, mood: null, water: null }, headline: '' },
    journal: { hasEntry: false, noteCount: 0, updatedAt: null },
    insight: null, insightCount: 0, loggedDays30: over.logged ?? 0,
  };
}

test('formatting helpers', () => {
  assert.equal(formatHour(9), '9:00');
  assert.equal(formatHour(13.5), '13:30');
  assert.equal(formatHour(15.25), '15:15');
  assert.equal(formatSleep(370), '6h10');
  assert.equal(formatSleep(420), '7h');
  assert.equal(formatClock(754), '12:34');
  assert.equal(formatClock(3725), '1:02:05');
});

test('pickPlan accepts a bare plan or { plan } and rejects junk', () => {
  const p = plan([block()]);
  assert.equal(pickPlan(p), p);
  assert.equal(pickPlan({ plan: p }), p);
  assert.equal(pickPlan({ ok: true }), null);
  assert.equal(pickPlan(null), null);
});

test('timer elapsed is derived from persisted startedAt (survives reload)', () => {
  const started = Date.UTC(2026, 9, 19, 16, 0, 0);
  assert.equal(elapsedSeconds({ startedAt: started }, started + 90_000), 90);
  assert.equal(elapsedSeconds({ startedAt: Math.floor(started / 1000) }, started + 5_000), 5, 'epoch seconds are accepted');
  assert.equal(elapsedSeconds({ startedAt: '2026-10-19 16:00:00' }, started + 60_000), 60, 'SQLite UTC string');
  assert.equal(elapsedSeconds({ startedAt: null }, started), 0);
  assert.equal(elapsedSeconds({ startedAt: started + 10_000 }, started), 0, 'clock skew never goes negative');
  assert.equal(toMs(''), null);
});

test('moveOptions offers later slots that still end before 22:00', () => {
  assert.deepEqual(moveOptions(10.2, { start: 9, minutes: 60 }), [11, 12, 13, 15]);
  assert.deepEqual(moveOptions(20.5, { start: 9, minutes: 60 }), [21]);
  assert.deepEqual(moveOptions(21.6, { start: 9, minutes: 60 }), []);
});

test('planStats and dayScore only use parts with data', () => {
  const p = plan([block({ id: 'a', status: 'done', loggedMinutes: 42 }), block({ id: 'b', status: 'skipped' }), block({ id: 'c' })]);
  assert.deepEqual(planStats(p), { total: 3, done: 1, skipped: 1, open: 1, plannedMin: 180, doneMin: 42 });
  const s = summary({ tasks: { total: 4, completed: 2, productivityScore: 50 } });
  const score = dayScore(p, s);
  assert.equal(score.parts.length, 2);
  assert.equal(score.score, Math.round((33 + 50) / 2));
  assert.equal(dayScore(null, summary()).score, null, 'nothing logged → no score, not zero');
});

test('encouragement is grounded in numbers, never generic praise', () => {
  const all = encouragement(plan([block({ status: 'done' }), block({ id: 'x', status: 'done' })]), summary({ cap: 58 }));
  assert.match(all, /all 2 planned blocks/);
  assert.match(all, /58% capacity/);
  const none = encouragement(plan([block()]), summary({ cap: 80 }), 'Ship it');
  assert.match(none, /None of the 1 blocks/);
  assert.match(none, /Tomorrow opens with “Ship it”/);
  const low = encouragement(plan([block({ status: 'done' }), block({ id: 'y' })]), summary({ cap: 50 }));
  assert.match(low, /Capacity was 50% and you still closed 1 of 2/);
  assert.match(encouragement(plan([]), summary()), /nothing to grade/);
  for (const line of [all, none, low]) assert.doesNotMatch(line, /amazing|awesome|crushed/i);
});

test('first run: only fresh accounts, completion needs sleep + 3 tasks + 2 habits', () => {
  assert.equal(isFreshAccount(summary()), true);
  assert.equal(isFreshAccount(summary({ logged: 21 })), false);
  assert.equal(isFreshAccount(summary({ habits: { total: 2 } })), false);
  assert.equal(isFreshAccount(null), false);
  assert.deepEqual(onboardingProgress(summary({ sleep: 400, tasks: { total: 2 }, habits: { total: 2 } }), 3),
    { sleep: true, tasks: 3, habits: 2, complete: true });
  assert.equal(onboardingProgress(summary({ sleep: 0, tasks: { total: 3 }, habits: { total: 2 } })).complete, false);
});

test('sleep + deferred helpers', () => {
  assert.equal(sleepMinutesBetween('23:00', '07:00'), 480);
  assert.equal(sleepMinutesBetween('01:30', '07:40'), 370);
  assert.equal(lastNightText(summary({ sleep: 370 })), 'Last night: 6h10.');
  assert.equal(lastNightText(summary()), null);
  assert.equal(deferredCount(plan([], { deferred: 4 })), 4);
  assert.equal(deferredCount(null), 0);
});
