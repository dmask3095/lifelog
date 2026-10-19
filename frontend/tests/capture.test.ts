// Run: npm test (node --test, native TypeScript type stripping; Node >= 22.18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHabitState, applyMvd, createSubmitGuard, describeError, isFresh, makePending, markError, markSaved,
  markSaving, mergeForDisplay, nextHabitState, parseQuickTitle, patchTask, removeTask, settledTempIds, taskKey,
  HIGHLIGHT_MS, type PendingAdd,
} from '../src/lib/capture.ts';
import type { Task } from '../src/types.ts';

const DATE = '2026-10-19';
let nextId = 100;
function task(over: Partial<Task> = {}): Task {
  nextId += 1;
  return {
    id: nextId, title: `Task ${nextId}`, description: null, status: 'pending', priority: 'medium', date: DATE,
    created_at: '2026-10-19T09:00:00Z', completed_at: null, energy_tag: 'quick', pool: 'today', scheduled_for: null,
    parent_task_id: null, ...over,
  };
}

// ---- optimistic add lifecycle ---------------------------------------------------
test('optimistic add: a saving row is pinned at the top before the server answers', () => {
  const server = [task({ priority: 'urgent' }), task()];
  const p = makePending({ title: '  Write   launch post ', date: DATE, priority: 'high' }, 'tmp-1', 1000);
  assert.equal(p.title, 'Write launch post');
  assert.equal(p.state, 'saving');
  const { pinned, rest } = mergeForDisplay(server, [p], [], DATE);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].kind, 'pending');
  assert.equal(rest.length, 2, 'server rows are untouched');
});

test('optimistic add: saved row uses the create response until the refetch arrives, then the server copy', () => {
  const created = task({ title: 'Write launch post' });
  let pending: PendingAdd[] = [makePending({ title: 'Write launch post', date: DATE }, 'tmp-1', 1000)];
  pending = markSaved(pending, 'tmp-1', created, 1200);

  const before = mergeForDisplay([task()], pending, [], DATE);
  assert.equal(before.pinned[0].kind, 'task');
  assert.equal(before.pinned[0].kind === 'task' && before.pinned[0].task.id, created.id);

  const fresher = { ...created, status: 'ongoing' as const };
  const after = mergeForDisplay([task(), fresher], pending, [], DATE);
  assert.equal(after.pinned.length, 1, 'no duplicate row');
  assert.equal(after.pinned[0].kind === 'task' && after.pinned[0].task.status, 'ongoing');
  assert.ok(!after.rest.some((t) => t.id === created.id), 'pinned task is not repeated in the groups');
  assert.deepEqual(settledTempIds(pending, [fresher]), ['tmp-1']);
  assert.deepEqual(settledTempIds(pending, []), []);
});

test('optimistic add: failure keeps the row visible with an error, retry flips it back to saving', () => {
  let pending = [makePending({ title: 'Pay rent', date: DATE }, 'tmp-9', 1000)];
  pending = markError(pending, 'tmp-9', 'Couldn’t reach the server. Check your connection and retry.');
  const { pinned } = mergeForDisplay([], pending, [], DATE);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].kind === 'pending' && pinned[0].pending.state, 'error');
  assert.match(pending[0].error ?? '', /reach the server/);
  pending = markSaving(pending, 'tmp-9', 2000);
  assert.equal(pending[0].state, 'saving');
  assert.equal(pending[0].error, undefined);
});

test('optimistic add: newest first, other dates excluded, earlier pinned ids follow', () => {
  const older = task({ title: 'older pinned' });
  const a = makePending({ title: 'first', date: DATE }, 'a', 1000);
  const b = makePending({ title: 'second', date: DATE }, 'b', 2000);
  const other = makePending({ title: 'tomorrow', date: '2026-10-20' }, 'c', 3000);
  const { pinned, rest } = mergeForDisplay([older, task()], [a, b, other], [older.id, 99999], DATE);
  assert.deepEqual(pinned.map((r) => r.key), ['b', 'a', `t${older.id}`], 'deleted pinned id 99999 is dropped');
  assert.equal(rest.length, 1);
});

test('highlight: saving/error always stand out; saved for HIGHLIGHT_MS only', () => {
  const base = makePending({ title: 'x', date: DATE }, 't', 0);
  assert.equal(isFresh(base, 10_000), true);
  const saved = markSaved([base], 't', task(), 1000)[0];
  assert.equal(isFresh(saved, 1000 + HIGHLIGHT_MS - 1), true);
  assert.equal(isFresh(saved, 1000 + HIGHLIGHT_MS), false);
});

// ---- Minimum Viable Day never hides a just-added task -----------------------------
test('MVD: top 2 open shown, completed kept, protected ids never hidden and do not use a slot', () => {
  const ts = [task(), task(), task(), task({ status: 'completed' }), task()];
  const off = applyMvd(ts, false);
  assert.equal(off.shown.length, 5);
  const on = applyMvd(ts, true);
  assert.deepEqual(on.shown.map((t) => t.id), [ts[0].id, ts[1].id, ts[3].id]);
  assert.equal(on.hidden.length, 2);
  const protectedOn = applyMvd(ts, true, new Set([ts[4].id]));
  assert.ok(protectedOn.shown.some((t) => t.id === ts[4].id));
  assert.equal(protectedOn.shown.length, 4);
});

test('MVD + merge: a just-added low-priority task stays visible even when MVD would park it', () => {
  const server = [task({ priority: 'urgent' }), task({ priority: 'high' }), task({ priority: 'medium' })];
  const added = task({ priority: 'low', title: 'just added' });
  const { pinned, rest } = mergeForDisplay([...server, added], [], [added.id], DATE);
  const { shown, hidden } = applyMvd(rest, true);
  assert.equal(pinned[0].kind === 'task' && pinned[0].task.id, added.id);
  assert.ok(!hidden.some((t) => t.id === added.id));
  assert.equal(shown.length, 2);
});

// ---- duplicate submit guard -------------------------------------------------------
test('guard: Enter + lagged click for the same task makes one request', () => {
  const g = createSubmitGuard(1500);
  const key = taskKey(DATE, ' Write  Post ');
  assert.equal(key, taskKey(DATE, 'write post'));
  assert.equal(g.begin(key, 0), 'ok');
  assert.equal(g.begin(key, 50), 'in-flight');
  g.end(key);
  assert.equal(g.begin(key, 400), 'duplicate', 'finished but still inside the lag window');
  assert.equal(g.begin(key, 1600), 'ok');
  assert.equal(g.begin(taskKey(DATE, 'other'), 1601), 'ok', 'different tasks are independent');
});

test('guard: lagged empty click right after a submit is recognisable; reset allows explicit retry', () => {
  const g = createSubmitGuard(1500);
  assert.equal(g.recentlyStarted(0), false);
  g.begin('k', 1000);
  assert.equal(g.recentlyStarted(1200), true);
  assert.equal(g.recentlyStarted(2600), false);
  g.end('k');
  g.reset('k');
  assert.equal(g.begin('k', 1100), 'ok', 'retry after failure is not eaten as duplicate');
});

test('guard with 0 window only blocks while in flight (row actions)', () => {
  const g = createSubmitGuard(0);
  assert.equal(g.begin('task:1', 0), 'ok');
  assert.equal(g.begin('task:1', 0), 'in-flight');
  assert.equal(g.busy('task:1'), true);
  g.end('task:1');
  assert.equal(g.begin('task:1', 0), 'ok');
});

// ---- inline syntax ------------------------------------------------------------------
test('parseQuickTitle: bangs and hashtags', () => {
  assert.deepEqual(parseQuickTitle('Ship launch post !'), { title: 'Ship launch post', priority: 'high', energy_tag: undefined });
  assert.deepEqual(parseQuickTitle('Pay rent!!'), { title: 'Pay rent', priority: 'urgent', energy_tag: undefined });
  assert.deepEqual(parseQuickTitle('Draft spec #deep #low'), { title: 'Draft spec', priority: 'low', energy_tag: 'deep' });
  assert.deepEqual(parseQuickTitle('Fix #42 in parser'), { title: 'Fix #42 in parser', priority: undefined, energy_tag: undefined });
  assert.deepEqual(parseQuickTitle('Learn C#'), { title: 'Learn C#', priority: undefined, energy_tag: undefined });
  assert.equal(parseQuickTitle('   ').title, '');
  assert.equal(parseQuickTitle('!').title, '!', 'a lone bang is a title, not a priority');
});

// ---- errors ------------------------------------------------------------------------
test('describeError: server message, session, 5xx, network, fallback', () => {
  assert.equal(describeError({ response: { status: 400, data: { error: 'title and date (YYYY-MM-DD) are required' } } }, 'x'), 'title and date (YYYY-MM-DD) are required');
  assert.match(describeError({ response: { status: 401 } }, 'x'), /session expired/);
  assert.match(describeError({ response: { status: 503 } }, 'Couldn’t save'), /server had a problem \(503\)/);
  assert.match(describeError({ code: 'ERR_NETWORK', message: 'Network Error' }, 'x'), /reach the server/);
  assert.equal(describeError(undefined, 'Couldn’t save'), 'Couldn’t save. Try again.');
});

// ---- row actions and habits ----------------------------------------------------------
test('patchTask / removeTask are pure and remove subtasks with their parent', () => {
  const parent = task();
  const child = task({ parent_task_id: parent.id });
  const ts = [parent, child, task()];
  const done = patchTask(ts, parent.id, { status: 'completed' });
  assert.equal(done[0].status, 'completed');
  assert.equal(ts[0].status, 'pending');
  assert.equal(removeTask(ts, parent.id).length, 1);
});

test('habits: tapping a tier checks in, tapping the active tier un-checks, today dot follows', () => {
  assert.deepEqual(nextHabitState({ completed: false, tier: null }, 'bronze'), { completed: true, tier: 'bronze' });
  assert.deepEqual(nextHabitState({ completed: true, tier: 'bronze' }, 'gold'), { completed: true, tier: 'gold' });
  assert.deepEqual(nextHabitState({ completed: true, tier: 'gold' }, 'gold'), { completed: false, tier: null });
  const habits = [{ id: 1, completed: false, tier: null, history14: [{ date: '2026-10-18', tier: 'silver' as const }, { date: DATE, tier: null }] }];
  const on = applyHabitState(habits, 1, { completed: true, tier: 'bronze' }, DATE);
  assert.equal(on[0].completed, true);
  assert.equal(on[0].history14[1].tier, 'bronze');
  assert.equal(on[0].history14[0].tier, 'silver');
  const off = applyHabitState(on, 1, { completed: false, tier: null }, DATE);
  assert.equal(off[0].tier, null);
  assert.equal(off[0].history14[1].tier, null);
  assert.equal(habits[0].completed, false, 'input not mutated');
});

test('habits: two stale taps from the same render resolve to the same state (lag-safe)', () => {
  const rendered = { completed: false, tier: null };
  const first = nextHabitState(rendered, 'silver');
  const second = nextHabitState(rendered, 'silver');
  assert.deepEqual(first, second);
});
