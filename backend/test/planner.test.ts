import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapacity } from '../src/lib/capacity';
import {
  buildPlan, habitBlockMinutes, deriveWindow, orderTasks, tierRules, timeCategoryFor, DEFAULT_WINDOW,
  type PlannerInput, type PlannerTask, type WindowLog,
} from '../src/lib/planner';

const DATE = '2026-10-19';

function task(id: number, over: Partial<PlannerTask> = {}): PlannerTask {
  return { id, title: `Task ${id}`, priority: 'medium', energy_tag: 'quick', status: 'pending', date: DATE, parent_task_id: null, ...over };
}

function input(over: Partial<PlannerInput> & { sleep?: number | null; moodScore?: number | null; water?: number | null } = {}): PlannerInput {
  const sleepMinutes = over.sleep === undefined ? 450 : over.sleep;
  const mood = over.moodScore === undefined ? 5 : over.moodScore;
  const waterMl = over.water === undefined ? 2000 : over.water;
  return {
    date: DATE,
    capacity: computeCapacity({ sleepMinutes, moodScore: mood, waterMl }),
    sleepMinutes, mood, waterMl,
    tasks: [
      task(1, { title: 'Write launch post', energy_tag: 'deep', priority: 'high' }),
      task(2, { title: 'Refactor API', energy_tag: 'deep' }),
      task(3, { title: 'Reply to Sam', energy_tag: 'quick' }),
      task(4, { title: 'Invoice', energy_tag: 'admin' }),
      task(5, { title: 'Book dentist', energy_tag: 'quick' }),
      task(6, { title: 'Stretch', energy_tag: 'recovery' }),
    ],
    habits: [
      { id: 1, name: 'Morning walk', floor_label: '5 min outside', target_label: '20 min walk', keptToday: false },
      { id: 2, name: 'Reading', floor_label: '2 pages', target_label: '20 min', keptToday: false },
      { id: 3, name: 'Meditation', floor_label: '3 breaths', target_label: '10 min', keptToday: true },
    ],
    window: DEFAULT_WINDOW,
    now: 1,
    ...over,
  };
}

const deep = (p: ReturnType<typeof buildPlan>) => p.blocks.filter((b) => b.energy === 'deep');

test('capacity scaling: peak gets two long deep blocks, low gets fewer/shorter, very low none', () => {
  const peak = buildPlan(input());
  assert.equal(peak.level, 'peak');
  assert.equal(deep(peak).length, 2);
  assert.ok(deep(peak).every((b) => b.minutes === 90));

  const steady = buildPlan(input({ sleep: 400, moodScore: 3, water: 1500 }));
  assert.equal(steady.level, 'steady');
  assert.equal(deep(steady).length, 1);
  assert.ok([60, 75].includes(deep(steady)[0].minutes));

  const low = buildPlan(input({ sleep: 370, moodScore: 2, water: 500 })); // ~58%
  assert.equal(low.level, 'recovery');
  assert.ok(low.capacity >= 45 && low.capacity < 65, `capacity ${low.capacity}`);
  assert.equal(deep(low).length, 1);
  assert.equal(deep(low)[0].minutes, 45);
  const lowHabits = low.blocks.filter((b) => b.kind === 'habit');
  assert.ok(lowHabits.length > 0 && lowHabits.every((b) => b.tier === 'bronze'), 'floor habits on low capacity');
  assert.ok(lowHabits.some((b) => b.title.includes('5 min outside')));
  assert.match(low.why, /6h10 sleep/);
  assert.match(low.why, /58% capacity|5\d% capacity/);
  assert.match(low.why, /floor habits/);
  assert.ok(low.deferred > peak.deferred, 'low capacity carries more without guilt');

  const veryLow = buildPlan(input({ sleep: 200, moodScore: 1, water: null }));
  assert.equal(deep(veryLow).length, 0);
  assert.equal(tierRules(veryLow.capacity).deepCount, 0);
  assert.match(veryLow.why, /no deep work/);
  assert.ok(veryLow.blocks.some((b) => b.kind === 'recovery' && b.minutes === 30));
});

test('unknown capacity assumes 70 and says so', () => {
  const p = buildPlan(input({ sleep: null, moodScore: null, water: null }));
  assert.equal(p.capacityKnown, false);
  assert.equal(p.capacity, 70);
  assert.match(p.why, /Nothing logged yet/);
});

test('kept habits are not planned again; habit blocks carry habitId', () => {
  const p = buildPlan(input());
  const habits = p.blocks.filter((b) => b.kind === 'habit');
  assert.deepEqual(habits.map((b) => b.habitId).sort(), [1, 2]);
});

test('deep blocks start at the energy window, admin batches after deep, nothing overlaps or runs past 22:00', () => {
  const p = buildPlan(input({ window: { start: 14, end: 17, source: 'time_logs', samples: 9 } }));
  const d = deep(p);
  assert.equal(d[0].start, 14);
  assert.match(p.why, /usual focus hours 14:00–17:00/);
  const admin = p.blocks.find((b) => b.kind === 'batch');
  assert.ok(admin && admin.taskIds && admin.taskIds.length >= 2);
  assert.equal(admin.start, 10, 'afternoon window → admin in the morning');
  const sorted = [...p.blocks].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].start + sorted[i - 1].minutes / 60;
    assert.ok(sorted[i].start >= prevEnd - 1e-9, `overlap at ${sorted[i].id}`);
  }
  assert.ok(p.blocks.every((b) => b.start + b.minutes / 60 <= 22 + 1e-9 && b.start * 4 === Math.round(b.start * 4)));

  const morning = buildPlan(input({ sleep: 400, moodScore: 3, water: 1500 }));
  assert.equal(deep(morning)[0].start, 9);
  const lowBatch = buildPlan(input({ sleep: 370, moodScore: 2, water: 500 })).blocks.find((b) => b.kind === 'batch' || ((b.energy === 'admin' || b.energy === 'quick') && b.kind === 'task'));
  assert.ok(lowBatch && lowBatch.start >= 13.5, 'low capacity → admin after lunch');
});

test('nowHour: nothing is placed in the past', () => {
  const p = buildPlan(input({ nowHour: 14.4 }));
  assert.ok(p.blocks.every((b) => b.start >= 14.5));
});

test('carry-over fairness: a medium task carried 3 days outranks a fresh high; ties stay deterministic', () => {
  const fresh = task(10, { priority: 'high', energy_tag: 'deep' });
  const old = task(11, { priority: 'medium', energy_tag: 'deep', date: '2026-10-16' });
  const urgent = task(12, { priority: 'urgent', energy_tag: 'deep' });
  // old: 20 + 12 = 32, urgent: 40, fresh: 30 → urgent, old, fresh
  assert.deepEqual(orderTasks([fresh, old, urgent], DATE).map((t) => t.id), [12, 11, 10]);
  const steady = buildPlan(input({ sleep: 400, moodScore: 3, water: 1500, tasks: [fresh, old] }));
  assert.equal(deep(steady)[0].taskId, 11);
  assert.match(deep(steady)[0].reason, /carried 3 days/);
  assert.equal(steady.deferred, 1);
  assert.match(steady.why, /1 task wait/);
  const a = buildPlan(input({ tasks: [task(21), task(20)] }));
  const b = buildPlan(input({ tasks: [task(20), task(21)] }));
  assert.deepEqual(a.blocks, b.blocks);
});

test('parents with open sub-steps are represented by their steps; hurdled tasks sink', () => {
  const parent = task(30, { energy_tag: 'deep', priority: 'urgent' });
  const step = task(31, { energy_tag: 'quick', parent_task_id: 30 });
  const p = buildPlan(input({ tasks: [parent, step] }));
  assert.ok(!p.blocks.some((b) => b.taskId === 30 || b.taskIds?.includes(30)));
  assert.ok(p.blocks.some((b) => b.taskId === 31 || b.taskIds?.includes(31)));
  const hurdled = task(40, { priority: 'medium', energy_tag: 'deep', hurdled: true });
  const clean = task(41, { priority: 'medium', energy_tag: 'deep' });
  assert.deepEqual(orderTasks([hurdled, clean], DATE).map((t) => t.id), [41, 40]);
});

test('replan keeps done/skipped blocks and does not re-plan their tasks', () => {
  const first = buildPlan(input());
  const doneBlock = { ...deep(first)[0], status: 'done' as const };
  const skipped = { ...first.blocks.find((b) => b.kind === 'batch')!, status: 'skipped' as const };
  const again = buildPlan(input({ keep: [doneBlock, skipped] }));
  assert.ok(again.blocks.some((b) => b.id === doneBlock.id && b.status === 'done'));
  const planned = again.blocks.filter((b) => b.status === 'planned');
  assert.ok(!planned.some((b) => b.taskId === doneBlock.taskId));
  assert.ok(!planned.some((b) => (b.taskIds ?? []).some((id) => skipped.taskIds!.includes(id))));
  assert.equal(new Set(again.blocks.map((b) => b.id)).size, again.blocks.length, 'ids stay unique');
});

function logAt(date: string, utcIso: string, minutes = 60, category = 'deep_work'): WindowLog {
  return { date, category, minutes, created_at: utcIso };
}

test('window: default 9–12 until 7 distinct same-day days; backfilled logs never count', () => {
  const six = Array.from({ length: 6 }, (_, i) => logAt(`2026-10-0${i + 1}`, `2026-10-0${i + 1} 16:00:00`));
  const w6 = deriveWindow(six, 'UTC');
  assert.deepEqual([w6.start, w6.end, w6.source, w6.samples], [9, 12, 'default', 6]);

  const backfilled = Array.from({ length: 10 }, (_, i) => logAt(`2026-10-${String(i + 1).padStart(2, '0')}`, '2026-10-19 21:36:12'));
  assert.equal(deriveWindow(backfilled, 'UTC').source, 'default');

  // 8 days of 2h deep work recorded at 16:00 local (work 14–16) + a little at 10.
  const seven = Array.from({ length: 8 }, (_, i) => {
    const d = `2026-10-${String(i + 1).padStart(2, '0')}`;
    return [logAt(d, `${d} 16:00:00`, 120), logAt(d, `${d} 10:30:00`, 20, 'learning')];
  }).flat();
  const w = deriveWindow(seven, 'UTC');
  assert.equal(w.source, 'time_logs');
  assert.equal(w.samples, 8);
  assert.ok(w.start <= 14 && w.end >= 16 && w.end - w.start === 3, JSON.stringify(w));

  // Same instants seen from Los Angeles (UTC-7): 16:00Z is 09:00 local.
  const la = Array.from({ length: 7 }, (_, i) => {
    const d = `2026-10-${String(i + 1).padStart(2, '0')}`;
    return logAt(d, `${d} 18:00:00`, 120); // 11:00 PDT, work 09–11
  });
  const wla = deriveWindow(la, 'America/Los_Angeles');
  assert.equal(wla.source, 'time_logs');
  assert.ok(wla.start <= 9 && wla.end >= 11, JSON.stringify(wla));
});

test('time categories for finished blocks', () => {
  assert.equal(timeCategoryFor({ energy: 'deep', title: 'x' }), 'deep_work');
  assert.equal(timeCategoryFor({ energy: 'admin', title: 'x' }), 'admin');
  assert.equal(timeCategoryFor({ energy: 'recovery', title: '20-min walk' }), 'exercise');
  assert.equal(timeCategoryFor({ energy: 'habit', title: 'Reading · 2 pages' }), 'learning');
  assert.equal(timeCategoryFor({ energy: 'habit', title: 'Meditation · 3 breaths' }), 'rested');
});

test('habit block duration follows explicit label minutes, with honest floor/target fallbacks', () => {
  assert.equal(habitBlockMinutes('20 min walk',false),20);
  assert.equal(habitBlockMinutes('Read 2 pages',true),5);
  assert.equal(habitBlockMinutes('Standard session',false),15);
  assert.equal(habitBlockMinutes('120 minutes',false),60);
});
