import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Isolated throwaway database: env must be set before the app modules load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifelog-plan-'));
process.env.TURSO_DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
process.env.JWT_SECRET = 'test-secret';
process.env.PUSH_SCHEDULER = 'off';

type DbMod = typeof import('../src/database');
let dbm: DbMod;
let server: Server;
let base = '';
let cookieA = '';
let cookieB = '';
let userA = 0;
let userB = 0;
const DATE = '2026-10-19';

before(async () => {
  dbm = require('../src/database');
  await dbm.dbReady;
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { signSession, SESSION_COOKIE } = require('../src/auth-utils');
  const router = require('../src/routes/day-plans').default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/day-plans', router);
  app.use((err: any, _req: any, res: any, _next: any) => { console.error(err); res.status(500).json({ error: String(err?.message ?? err) }); });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/day-plans`;

  const db = dbm.default;
  userA = Number((await db.run("INSERT INTO users (email, password_hash) VALUES ('a@test.dev', 'x')")).lastInsertRowid);
  userB = Number((await db.run("INSERT INTO users (email, password_hash) VALUES ('b@test.dev', 'x')")).lastInsertRowid);
  cookieA = `${SESSION_COOKIE}=${signSession(userA)}`;
  cookieB = `${SESSION_COOKIE}=${signSession(userB)}`;

  // User A: 6h10 sleep, mood 2 → recovery-level day (64%); a deep task, quick tasks, a habit.
  await db.run("INSERT INTO body_logs (user_id, date, type, duration_minutes) VALUES (?, ?, 'sleep', 370)", userA, DATE);
  await db.run('INSERT INTO moods (user_id, date, score) VALUES (?, ?, 2)', userA, DATE);
  await db.run("INSERT INTO tasks (user_id, title, priority, date, energy_tag) VALUES (?, 'Write the launch post', 'high', ?, 'deep')", userA, '2026-10-17');
  await db.run("INSERT INTO tasks (user_id, title, priority, date, energy_tag) VALUES (?, 'Reply to Sam', 'medium', ?, 'quick')", userA, DATE);
  await db.run("INSERT INTO tasks (user_id, title, priority, date, energy_tag) VALUES (?, 'Pay invoice', 'medium', ?, 'admin')", userA, DATE);
  await db.run("INSERT INTO habits (user_id, name, floor_label, target_label) VALUES (?, 'Reading', '2 pages', '20 min')", userA);
  // User B: a private task that must never leak into A's plan.
  await db.run("INSERT INTO tasks (user_id, title, priority, date, energy_tag) VALUES (?, 'B secret project', 'urgent', ?, 'deep')", userB, DATE);
});

after(async () => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, url: string, cookie: string, body?: unknown) {
  const res = await fetch(base + url, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('auth required', async () => {
  const res = await fetch(`${base}/${DATE}`);
  assert.equal(res.status, 401);
});

test('GET generates once, is idempotent under concurrent first opens, and matches the contract shape', async () => {
  const [a1, a2, a3] = await Promise.all([1, 2, 3].map(() => call('GET', `/${DATE}`, cookieA)));
  for (const r of [a1, a2, a3]) assert.equal(r.status, 200);
  assert.equal(a1.body.generatedAt, a2.body.generatedAt);
  assert.equal(a2.body.generatedAt, a3.body.generatedAt);
  const rows = await dbm.default.all('SELECT id FROM day_plans WHERE user_id = ? AND date = ?', userA, DATE);
  assert.equal(rows.length, 1);

  const p = a1.body;
  assert.equal(p.date, DATE);
  assert.equal(typeof p.capacity, 'number');
  assert.equal(p.level, 'recovery');
  assert.equal(typeof p.why, 'string');
  assert.match(p.why, /6h10 sleep · mood 2\/5 → 64% capacity/);
  assert.deepEqual([p.window.start, p.window.end, p.window.source], [9, 12, 'default']);
  assert.equal(p.accepted, false);
  assert.equal(typeof p.deferred, 'number');
  assert.ok(Array.isArray(p.blocks) && p.blocks.length >= 3);
  for (const b of p.blocks) {
    assert.equal(typeof b.id, 'string');
    assert.equal(typeof b.start, 'number');
    assert.equal(typeof b.minutes, 'number');
    assert.equal(b.status, 'planned');
  }
  const deepBlock = p.blocks.find((b: any) => b.energy === 'deep');
  assert.equal(deepBlock.title, 'Write the launch post');
  assert.equal(deepBlock.minutes, 45);
  assert.ok(p.blocks.some((b: any) => b.kind === 'habit' && b.tier === 'bronze'));
  assert.ok(!JSON.stringify(p).includes('B secret project'));

  const again = await call('GET', `/${DATE}`, cookieA);
  assert.deepEqual(again.body, p, 'second GET returns the stored plan unchanged');
});

test('account isolation: B gets its own plan; B cannot act on A’s plan', async () => {
  const b = await call('GET', `/${DATE}`, cookieB);
  assert.equal(b.status, 200);
  assert.ok(b.body.blocks.some((x: any) => x.title === 'B secret project'));
  assert.ok(!b.body.blocks.some((x: any) => x.title === 'Write the launch post'));
  const a = (await call('GET', `/${DATE}`, cookieA)).body;
  const aDeep = a.blocks.find((x: any) => x.energy === 'deep');
  const r = await call('POST', `/${DATE}/blocks/${aDeep.id}/action`, cookieB, { action: 'done' });
  assert.equal(r.status, 404);
  const task = await dbm.default.get<any>('SELECT status FROM tasks WHERE id = ?', aDeep.taskId);
  assert.notEqual(task.status, 'completed');
  // A plan B never generated: actions 404.
  assert.equal((await call('POST', `/2026-10-20/blocks/recovery/action`, cookieB, { action: 'start' })).status, 404);
});

test('validation', async () => {
  assert.equal((await call('GET', '/2026-13-40', cookieA)).status, 400);
  assert.equal((await call('POST', `/${DATE}/blocks/x/action`, cookieA, { action: 'explode' })).status, 400);
  assert.equal((await call('POST', `/${DATE}/blocks/nope/action`, cookieA, { action: 'start' })).status, 404);
  const p = (await call('GET', `/${DATE}`, cookieA)).body;
  assert.equal((await call('POST', `/${DATE}/blocks/${p.blocks[0].id}/action`, cookieA, { action: 'move' })).status, 400);
  assert.equal((await call('POST', `/${DATE}/blocks/${p.blocks[0].id}/action`, cookieA, { action: 'move', startHour: 2 })).status, 400);
  assert.equal((await call('PATCH', `/${DATE}`, cookieA, { accepted: 'yes' })).status, 400);
});

async function setStartedAt(userId: number, blockId: string, startedAt: number) {
  const row = await dbm.default.get<any>('SELECT plan FROM day_plans WHERE user_id = ? AND date = ?', userId, DATE);
  const plan = JSON.parse(row.plan);
  plan.blocks.find((b: any) => b.id === blockId).startedAt = startedAt;
  await dbm.default.run('UPDATE day_plans SET plan = ? WHERE user_id = ? AND date = ?', JSON.stringify(plan), userId, DATE);
}

test('start → done logs elapsed time exactly once and completes the task; repeats are no-ops', async () => {
  const p = (await call('GET', `/${DATE}`, cookieA)).body;
  const block = p.blocks.find((b: any) => b.energy === 'deep');

  const s1 = await call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'start' });
  const started = s1.body.blocks.find((b: any) => b.id === block.id);
  assert.equal(started.status, 'active');
  assert.equal(typeof started.startedAt, 'number');
  const s2 = await call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'start' });
  assert.equal(s2.body.blocks.find((b: any) => b.id === block.id).startedAt, started.startedAt, 'second start keeps the timer');

  await setStartedAt(userA, block.id, Date.now() - 32 * 60000);
  const [d1, d2] = await Promise.all([
    call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'done' }),
    call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'done' }),
  ]);
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  const d3 = await call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'done' });
  const done = d3.body.blocks.find((b: any) => b.id === block.id);
  assert.equal(done.status, 'done');
  assert.equal(done.loggedMinutes, 32);
  assert.equal(done.startedAt, undefined);

  const logs = await dbm.default.all<any>('SELECT * FROM time_logs WHERE user_id = ? AND date = ?', userA, DATE);
  assert.equal(logs.length, 1, 'exactly one time log');
  assert.equal(logs[0].category, 'deep_work');
  assert.equal(Number(logs[0].minutes), 32);
  assert.equal(logs[0].note, 'Plan: Write the launch post');
  const t = await dbm.default.get<any>('SELECT status, date, completed_at FROM tasks WHERE id = ?', block.taskId);
  assert.equal(t.status, 'completed');
  assert.equal(t.date, DATE, 'carried task is credited to the day it was finished');
  assert.ok(t.completed_at);
  assert.equal((await call('POST', `/${DATE}/blocks/${block.id}/action`, cookieA, { action: 'start' })).status, 409);
});

test('done without start logs nothing but completes; habit blocks log the tier without downgrading', async () => {
  const p = (await call('GET', `/${DATE}`, cookieA)).body;
  const admin = p.blocks.find((b: any) => b.energy === 'admin' || b.energy === 'quick');
  const r = await call('POST', `/${DATE}/blocks/${admin.id}/action`, cookieA, { action: 'done' });
  assert.equal(r.body.blocks.find((b: any) => b.id === admin.id).loggedMinutes, 0);
  const ids = admin.taskIds ?? [admin.taskId];
  for (const id of ids) {
    assert.equal((await dbm.default.get<any>('SELECT status FROM tasks WHERE id = ?', id)).status, 'completed');
  }
  assert.equal((await dbm.default.all('SELECT id FROM time_logs WHERE user_id = ?', userA)).length, 1);

  const habit = p.blocks.find((b: any) => b.kind === 'habit');
  await dbm.default.run("INSERT INTO habit_logs (user_id, habit_id, date, completed, tier) VALUES (?, ?, ?, 1, 'gold')", userA, habit.habitId, DATE);
  await call('POST', `/${DATE}/blocks/${habit.id}/action`, cookieA, { action: 'done' });
  const log = await dbm.default.get<any>('SELECT completed, tier FROM habit_logs WHERE habit_id = ? AND date = ?', habit.habitId, DATE);
  assert.equal(Number(log.completed), 1);
  assert.equal(log.tier, 'gold');
});

test('skip and move persist; move un-skips; replan keeps finished/skipped blocks', async () => {
  const p = (await call('GET', `/${DATE}`, cookieA)).body;
  const rec = p.blocks.find((b: any) => b.kind === 'recovery');
  let r = await call('POST', `/${DATE}/blocks/${rec.id}/action`, cookieA, { action: 'skip' });
  assert.equal(r.body.blocks.find((b: any) => b.id === rec.id).status, 'skipped');
  r = await call('POST', `/${DATE}/blocks/${rec.id}/action`, cookieA, { action: 'move', startHour: 16.6 });
  const moved = r.body.blocks.find((b: any) => b.id === rec.id);
  assert.equal(moved.start, 16.5);
  assert.equal(moved.status, 'planned');
  r = await call('POST', `/${DATE}/blocks/${rec.id}/action`, cookieA, { action: 'skip' });

  const doneIds = r.body.blocks.filter((b: any) => b.status === 'done').map((b: any) => b.id).sort();
  const rp = await call('POST', `/${DATE}/replan`, cookieA, { nowHour: 15, tz: 'America/Los_Angeles' });
  assert.equal(rp.status, 200);
  assert.deepEqual(rp.body.blocks.filter((b: any) => b.status === 'done').map((b: any) => b.id).sort(), doneIds);
  assert.equal(rp.body.blocks.find((b: any) => b.id === rec.id).status, 'skipped');
  assert.ok(rp.body.blocks.filter((b: any) => b.status === 'planned').every((b: any) => b.start >= 15));
  assert.equal((await dbm.default.all('SELECT id FROM time_logs WHERE user_id = ?', userA)).length, 1, 'replan never logs time');
});

test('accept + evening wrap: tomorrow top becomes one real task, hurdle one real hurdle; re-saves update, not duplicate', async () => {
  let r = await call('PATCH', `/${DATE}`, cookieA, { accepted: true });
  assert.equal(r.body.accepted, true);
  const acceptedAt = r.body.acceptedAt;
  assert.equal(typeof acceptedAt, 'number');
  r = await call('PATCH', `/${DATE}`, cookieA, { accepted: true });
  assert.equal(r.body.acceptedAt, acceptedAt, 'acceptance time is stable');

  const blockedTask = Number((await dbm.default.run("INSERT INTO tasks (user_id,title,date,energy_tag) VALUES (?, 'Get logo files', ?, 'admin')", userA, DATE)).lastInsertRowid);
  r = await call('PATCH', `/${DATE}`, cookieA, {
    wrap: { completed: ['Write the launch post', 'Pay invoice'], hurdle: 'Waiting on the logo files', hurdleTaskId: blockedTask, tomorrowTop: 'Record the demo video' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = r.body.wrap;
  assert.deepEqual(w.completed, ['Write the launch post', 'Pay invoice']);
  assert.equal(typeof w.tomorrowTaskId, 'number');
  const t = await dbm.default.get<any>('SELECT * FROM tasks WHERE id = ?', w.tomorrowTaskId);
  assert.equal(t.title, 'Record the demo video');
  assert.equal(t.date, '2026-10-20');
  assert.equal(t.priority, 'high');
  assert.equal(Number(t.user_id), userA);
  const h = await dbm.default.get<any>('SELECT * FROM hurdles WHERE id = ?', w.hurdleId);
  assert.equal(h.description, 'Waiting on the logo files');
  assert.equal(Number(h.task_id), blockedTask);

  r = await call('PATCH', `/${DATE}`, cookieA, { wrap: { tomorrowTop: 'Record the 60s demo video', hurdle: 'Logo files late' } });
  assert.equal(r.body.wrap.tomorrowTaskId, w.tomorrowTaskId);
  assert.deepEqual(r.body.wrap.completed, ['Write the launch post', 'Pay invoice'], 'omitted fields are kept');
  const tasks = await dbm.default.all<any>("SELECT title FROM tasks WHERE user_id = ? AND date = '2026-10-20'", userA);
  assert.deepEqual(tasks.map((x) => x.title), ['Record the 60s demo video']);
  const hurdles = await dbm.default.all<any>('SELECT description FROM hurdles WHERE user_id = ?', userA);
  assert.deepEqual(hurdles.map((x) => x.description), ['Logo files late']);

  // Tomorrow's plan picks the top 1 up.
  const tomorrow = await call('GET', '/2026-10-20', cookieA);
  assert.ok(tomorrow.body.blocks.some((b: any) => b.taskId === w.tomorrowTaskId || (b.taskIds ?? []).includes(w.tomorrowTaskId)));

  // Clearing the hurdle resolves it instead of deleting history.
  r = await call('PATCH', `/${DATE}`, cookieA, { wrap: { hurdle: '' } });
  assert.equal(r.body.wrap.hurdle, null);
  const resolved = await dbm.default.get<any>('SELECT resolved_at FROM hurdles WHERE id = ?', w.hurdleId);
  assert.ok(resolved.resolved_at);
  // B sees none of it.
  const b = (await call('GET', `/${DATE}`, cookieB)).body;
  assert.equal(b.accepted, false);
  assert.equal(b.wrap, undefined);
});


test('wrap reuses a selected existing task, saves once, and does not guess the hurdle relationship', async () => {
  const date = '2026-10-22';
  const id = Number((await dbm.default.run("INSERT INTO tasks (user_id,title,date,energy_tag,priority) VALUES (?, 'Existing top task', ?, 'deep', 'medium')", userA, date)).lastInsertRowid);
  const before = Number((await dbm.default.get<any>('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', userA)).n);
  const body = {wrap:{tomorrowTop:'Existing top task',tomorrowTaskId:id,createTomorrowTask:false,hurdle:'A daily hurdle, no chosen task',completed:[]}};
  const a = await call('PATCH', `/${date}`, cookieA, body);
  const b = await call('PATCH', `/${date}`, cookieA, body);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(b.body.wrap.tomorrowTaskId,id);
  assert.equal(b.body.wrap.hurdleId,undefined);
  const task = await dbm.default.get<any>('SELECT * FROM tasks WHERE id = ?',id);
  assert.equal(task.date,'2026-10-23');assert.equal(task.priority,'high');
  assert.equal(Number((await dbm.default.get<any>('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', userA)).n),before);
  const privateId = Number((await dbm.default.get<any>('SELECT id FROM tasks WHERE user_id = ? LIMIT 1',userB)).id);
  assert.equal((await call('PATCH', `/${date}`,cookieA,{wrap:{tomorrowTaskId:privateId,tomorrowTop:'No leak'}})).status,404);
});

test('one active timer at a time and moves cannot overlap or run beyond 22:00', async () => {
  const date = '2026-11-01';
  await dbm.default.run("INSERT INTO tasks (user_id,title,date,energy_tag) VALUES (?, 'Fresh deep block', ?, 'deep')",userA,date);
  const p=(await call('GET',`/${date}`,cookieA)).body;
  const [a,b,c]=p.blocks;
  assert.ok(a && b && c);
  assert.equal((await call('POST',`/${date}/blocks/${a.id}/action`,cookieA,{action:'start'})).status,200);
  assert.equal((await call('POST',`/${date}/blocks/${b.id}/action`,cookieA,{action:'start'})).status,409);
  assert.equal((await call('POST',`/${date}/blocks/${a.id}/action`,cookieA,{action:'start'})).status,200);
  assert.equal((await call('POST',`/${date}/blocks/${c.id}/action`,cookieA,{action:'move',startHour:b.start})).status,409);
  assert.equal((await call('POST',`/${date}/blocks/${c.id}/action`,cookieA,{action:'move',startHour:23})).status,400);
});
