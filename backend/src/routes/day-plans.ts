import { Router, Request, Response } from 'express';
import db, { withTransaction, ENERGY_TAGS, type DbHandle } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { computeCapacity } from '../lib/capacity';
import { isIsoDate, shiftDate } from '../lib/dates';
import {
  buildPlan, deriveWindow, isValidTimeZone, quarter, timeCategoryFor,
  type DayPlan, type PlanBlock, type PlannerTask,
} from '../lib/planner';

// Energy-aware day plan + morning/evening rituals. Contract: notes/v2.1-planner-contract.md
const router = Router();
router.use(requireAuth);

const WINDOW_LOOKBACK_DAYS = 42;
const MAX_LOGGED_MINUTES = 240;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function parseNowHour(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 24 ? n : null;
}

async function loadInputs(q: DbHandle, userId: number, date: string, tz: string | undefined) {
  const [tasks, hurdled, habits, keptRows, sleepRow, moodRow, healthRow, windowLogs] = await Promise.all([
    q.all<any>(
      `SELECT id, title, priority, energy_tag, status, date, parent_task_id FROM tasks
       WHERE user_id = ? AND pool IN ('today','scheduled') AND status != 'completed' AND date <= ?`,
      userId, date
    ),
    q.all<any>('SELECT DISTINCT task_id FROM hurdles WHERE user_id = ? AND resolved_at IS NULL', userId),
    q.all<any>('SELECT id, name, floor_label, target_label FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY id ASC', userId),
    q.all<any>('SELECT habit_id FROM habit_logs WHERE user_id = ? AND date = ? AND completed = 1', userId, date),
    q.get<any>("SELECT SUM(duration_minutes) AS m FROM body_logs WHERE user_id = ? AND date = ? AND type = 'sleep'", userId, date),
    q.get<any>('SELECT score FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date),
    q.get<any>('SELECT water_ml FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date),
    q.all<any>(
      `SELECT date, category, minutes, created_at FROM time_logs
       WHERE user_id = ? AND category IN ('deep_work','learning') AND date BETWEEN ? AND ?`,
      userId, shiftDate(date, -WINDOW_LOOKBACK_DAYS), date
    ),
  ]);
  const hurdledIds = new Set(hurdled.map((h: any) => Number(h.task_id)));
  const kept = new Set(keptRows.map((k: any) => Number(k.habit_id)));
  const sleepMinutes = sleepRow?.m != null && Number(sleepRow.m) > 0 ? Number(sleepRow.m) : null;
  const mood = moodRow ? Number(moodRow.score) : null;
  const waterMl = healthRow && Number(healthRow.water_ml) > 0 ? Number(healthRow.water_ml) : null;
  return {
    tasks: tasks.map((t: any): PlannerTask => ({
      id: Number(t.id), title: String(t.title), priority: t.priority, energy_tag: t.energy_tag, status: t.status,
      date: String(t.date), parent_task_id: t.parent_task_id != null ? Number(t.parent_task_id) : null,
      hurdled: hurdledIds.has(Number(t.id)),
    })),
    habits: habits.map((h: any) => ({
      id: Number(h.id), name: String(h.name), floor_label: h.floor_label, target_label: h.target_label, keptToday: kept.has(Number(h.id)),
    })),
    sleepMinutes, mood, waterMl,
    capacity: computeCapacity({ sleepMinutes, moodScore: mood, waterMl }),
    window: deriveWindow(windowLogs.map((l: any) => ({ ...l, minutes: Number(l.minutes) })), tz),
  };
}

async function generate(q: DbHandle, userId: number, date: string, opts: { nowHour: number | null; tz?: string; keep?: PlanBlock[] }) {
  const inputs = await loadInputs(q, userId, date, opts.tz);
  return buildPlan({ date, ...inputs, nowHour: opts.nowHour, keep: opts.keep });
}

interface PlanRow { plan: string; accepted: number; wrap: string | null; accepted_at: number | null }

function hydrate(row: PlanRow): DayPlan {
  const plan = JSON.parse(row.plan) as DayPlan;
  plan.accepted = Number(row.accepted) === 1;
  if (row.accepted_at != null) plan.acceptedAt = Number(row.accepted_at);
  else delete plan.acceptedAt;
  if (row.wrap) plan.wrap = JSON.parse(row.wrap);
  else delete plan.wrap;
  return plan;
}

async function readRow(q: DbHandle, userId: number, date: string): Promise<PlanRow | undefined> {
  return q.get<PlanRow>('SELECT plan, accepted, accepted_at, wrap FROM day_plans WHERE user_id = ? AND date = ?', userId, date);
}

async function savePlan(q: DbHandle, userId: number, plan: DayPlan) {
  const { accepted: _a, acceptedAt: _b, wrap: _w, ...body } = plan;
  await q.run(
    'UPDATE day_plans SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND date = ?',
    JSON.stringify(body), userId, plan.date
  );
}

/** Returns the stored plan, generating + inserting it once if absent (safe under concurrent first opens). */
async function getOrCreate(userId: number, date: string, nowHour: number | null, tz?: string): Promise<DayPlan> {
  const existing = await readRow(db, userId, date);
  if (existing) return hydrate(existing);
  const plan = await generate(db, userId, date, { nowHour, tz });
  const { accepted: _a, acceptedAt: _b, wrap: _w, ...body } = plan;
  await db.run(
    `INSERT INTO day_plans (user_id, date, plan) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO NOTHING`,
    userId, date, JSON.stringify(body)
  );
  return hydrate((await readRow(db, userId, date))!);
}

/** Read-time reconciliation: a linked task completed elsewhere shows as done (not persisted, nothing logged). */
async function reconcile(userId: number, plan: DayPlan): Promise<DayPlan> {
  const ids = new Set<number>();
  for (const b of plan.blocks) {
    if (b.status === 'done') continue;
    if (b.taskId != null) ids.add(b.taskId);
    (b.taskIds ?? []).forEach((id) => ids.add(id));
  }
  if (ids.size === 0) return plan;
  const list = [...ids];
  const rows = await db.all<any>(
    `SELECT id FROM tasks WHERE user_id = ? AND status = 'completed' AND id IN (${list.map(() => '?').join(',')})`,
    userId, ...list
  );
  const done = new Set(rows.map((r: any) => Number(r.id)));
  for (const b of plan.blocks) {
    if (b.status === 'done') continue;
    const linked = b.taskId != null ? [b.taskId] : b.taskIds ?? [];
    if (linked.length > 0 && linked.every((id) => done.has(id))) {
      b.status = 'done';
      delete b.startedAt;
    }
  }
  return plan;
}

function dateParam(req: Request): string {
  const date = String(req.params.date);
  if (!isIsoDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  return date;
}

function tzParam(raw: unknown): string | undefined {
  return isValidTimeZone(raw) ? raw : undefined;
}

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
};

// GET /api/day-plans/:date?nowHour=&tz= — the plan, generated on first open.
router.get('/:date', handle(async (req, res) => {
  const userId = req.userId as number;
  const date = dateParam(req);
  const plan = await getOrCreate(userId, date, parseNowHour(req.query.nowHour), tzParam(req.query.tz));
  res.json(await reconcile(userId, plan));
}));

// POST /api/day-plans/:date/replan — regenerate from the latest logs, keeping finished/started/skipped blocks.
router.post('/:date/replan', handle(async (req, res) => {
  const userId = req.userId as number;
  const date = dateParam(req);
  const nowHour = parseNowHour(req.body?.nowHour);
  const tz = tzParam(req.body?.tz);
  await getOrCreate(userId, date, nowHour, tz);
  const plan = await withTransaction(async (tx) => {
    const current = hydrate((await readRow(tx, userId, date))!);
    const keep = current.blocks.filter((b) => b.status !== 'planned');
    const fresh = await generate(tx, userId, date, { nowHour, tz, keep });
    await savePlan(tx, userId, fresh);
    return hydrate((await readRow(tx, userId, date))!);
  });
  res.json(await reconcile(userId, plan));
}));

function cleanText(raw: unknown, max = 200): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

// PATCH /api/day-plans/:date — accept the plan and/or save the evening wrap.
router.patch('/:date', handle(async (req, res) => {
  const userId = req.userId as number;
  const date = dateParam(req);
  const { accepted, wrap } = req.body ?? {};
  if (accepted !== undefined && typeof accepted !== 'boolean') throw new HttpError(400, 'accepted must be a boolean');
  if (wrap !== undefined && (wrap === null || typeof wrap !== 'object' || Array.isArray(wrap))) throw new HttpError(400, 'wrap must be an object');
  if (wrap?.completed !== undefined && (!Array.isArray(wrap.completed) || wrap.completed.length > 50)) {
    throw new HttpError(400, 'wrap.completed must be an array of up to 50 strings');
  }
  if (wrap?.tomorrowEnergy !== undefined && !(ENERGY_TAGS as readonly string[]).includes(wrap.tomorrowEnergy)) {
    throw new HttpError(400, 'invalid wrap.tomorrowEnergy');
  }
  await getOrCreate(userId, date, null);

  const plan = await withTransaction(async (tx) => {
    const row = (await readRow(tx, userId, date))!;
    if (accepted !== undefined) {
      const wasAccepted = Number(row.accepted) === 1;
      await tx.run(
        'UPDATE day_plans SET accepted = ?, accepted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND date = ?',
        accepted ? 1 : 0, accepted ? (wasAccepted && row.accepted_at != null ? Number(row.accepted_at) : Date.now()) : null, userId, date
      );
    }
    if (wrap !== undefined) {
      const prev = row.wrap ? JSON.parse(row.wrap) : {};
      const next: any = {
        hurdle: wrap.hurdle !== undefined ? cleanText(wrap.hurdle, 500) : prev.hurdle ?? null,
        tomorrowTop: wrap.tomorrowTop !== undefined ? cleanText(wrap.tomorrowTop) : prev.tomorrowTop ?? null,
        completed: wrap.completed !== undefined
          ? (wrap.completed as unknown[]).map((c) => cleanText(c)).filter((c): c is string => !!c)
          : prev.completed ?? [],
        savedAt: Date.now(),
      };
      if (prev.tomorrowTaskId != null) next.tomorrowTaskId = prev.tomorrowTaskId;
      if (prev.hurdleId != null) { next.hurdleId = prev.hurdleId; next.hurdleTaskId = prev.hurdleTaskId; }
      // A chosen existing task is the same canonical task, never a duplicate.
      if (wrap.tomorrowTaskId != null) {
        const chosen = await tx.get<any>('SELECT id, status FROM tasks WHERE id = ? AND user_id = ?', wrap.tomorrowTaskId, userId);
        if (!chosen) throw new HttpError(404, 'tomorrowTaskId not found');
        if (chosen.status === 'completed') throw new HttpError(409, 'Choose an open task for tomorrow');
        next.tomorrowTaskId = Number(chosen.id);
      }

      // Tomorrow's top 1 becomes a real high-priority task dated tomorrow, exactly once (later saves rename it).
      if (next.tomorrowTop && (wrap.createTomorrowTask !== false || next.tomorrowTaskId != null)) {
        const existing = next.tomorrowTaskId != null
          ? await tx.get<any>('SELECT id, status FROM tasks WHERE id = ? AND user_id = ?', next.tomorrowTaskId, userId)
          : undefined;
        if (existing) {
          await tx.run(`UPDATE tasks SET title = ?, date = ?, pool = 'today', scheduled_for = NULL,
            priority = CASE WHEN priority = 'urgent' THEN priority ELSE 'high' END
            WHERE id = ? AND user_id = ? AND status != 'completed'`, next.tomorrowTop, shiftDate(date, 1), existing.id, userId);
          if (wrap.tomorrowEnergy) await tx.run('UPDATE tasks SET energy_tag = ? WHERE id = ? AND user_id = ?', wrap.tomorrowEnergy, existing.id, userId);
        } else {
          const r = await tx.run(
            `INSERT INTO tasks (user_id, title, description, priority, date, energy_tag, pool)
             VALUES (?, ?, ?, 'high', ?, ?, 'today')`,
            userId, next.tomorrowTop, `Top 1 from the ${date} evening wrap`, shiftDate(date, 1), wrap.tomorrowEnergy ?? 'deep'
          );
          next.tomorrowTaskId = Number(r.lastInsertRowid);
        }
      }

      // The named hurdle becomes a real hurdle (once; later saves edit it, clearing resolves it).
      if (wrap.hurdle !== undefined || wrap.hurdleTaskId !== undefined) {
        const live = next.hurdleId != null
          ? await tx.get<any>('SELECT id FROM hurdles WHERE id = ? AND user_id = ?', next.hurdleId, userId)
          : undefined;
        if (next.hurdle && live) {
          await tx.run('UPDATE hurdles SET description = ?, resolved_at = NULL, resolution = NULL WHERE id = ?', next.hurdle, live.id);
        } else if (next.hurdle) {
          let taskId: number | null = null;
          if (wrap.hurdleTaskId != null) {
            const t = await tx.get<any>('SELECT id FROM tasks WHERE id = ? AND user_id = ?', wrap.hurdleTaskId, userId);
            if (!t) throw new HttpError(404, 'hurdleTaskId not found');
            taskId = Number(t.id);
          } // An unlinked daily hurdle stays in the wrap; never guess which task it blocked.
          if (taskId != null) {
            const r = await tx.run('INSERT INTO hurdles (user_id, task_id, description) VALUES (?, ?, ?)', userId, taskId, next.hurdle);
            await tx.run("UPDATE tasks SET status = 'needs_attention' WHERE id = ? AND user_id = ? AND status != 'completed'", taskId, userId);
            next.hurdleId = Number(r.lastInsertRowid);
            next.hurdleTaskId = taskId;
          }
        } else if (live) {
          await tx.run("UPDATE hurdles SET resolved_at = CURRENT_TIMESTAMP, resolution = 'Cleared in evening wrap' WHERE id = ?", live.id);
          await tx.run(
            `UPDATE tasks SET status = 'ongoing' WHERE id = ? AND user_id = ? AND status = 'needs_attention'
               AND NOT EXISTS (SELECT 1 FROM hurdles WHERE task_id = tasks.id AND resolved_at IS NULL)`,
            next.hurdleTaskId, userId
          );
          delete next.hurdleId;
          delete next.hurdleTaskId;
        }
      }
      await tx.run('UPDATE day_plans SET wrap = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND date = ?', JSON.stringify(next), userId, date);
    }
    return hydrate((await readRow(tx, userId, date))!);
  });
  res.json(await reconcile(userId, plan));
}));

const ACTIONS = ['start', 'done', 'skip', 'move'] as const;

// POST /api/day-plans/:date/blocks/:id/action { action, startHour? } — idempotent block state machine.
router.post('/:date/blocks/:id/action', handle(async (req, res) => {
  const userId = req.userId as number;
  const date = dateParam(req);
  const blockId = String(req.params.id);
  const action = req.body?.action;
  if (!(ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, 'action must be start, done, skip or move');
  let startHour: number | null = null;
  if (action === 'move') {
    const n = Number(req.body?.startHour);
    if (req.body?.startHour === undefined || req.body?.startHour === null || !Number.isFinite(n) || n < 5 || n > 23.75) {
      throw new HttpError(400, 'startHour must be a number between 5 and 23.75');
    }
    startHour = quarter(n);
  }

  const plan = await withTransaction(async (tx) => {
    const row = await readRow(tx, userId, date);
    if (!row) throw new HttpError(404, 'No plan for this date yet');
    const current = hydrate(row);
    const block = current.blocks.find((b) => b.id === blockId);
    if (!block) throw new HttpError(404, 'Block not found');
    const now = Date.now();
    const wasSkipped = block.status === 'skipped';
    const linkedIds = block.taskId != null ? [block.taskId] : block.taskIds ?? [];
    let linkedOpen = 0;
    for (const id of linkedIds) {
      const t = await tx.get<any>('SELECT status FROM tasks WHERE id = ? AND user_id = ?', id, userId);
      if (t && t.status !== 'completed') linkedOpen++;
    }

    if (action === 'start') {
      if (block.status === 'done') throw new HttpError(409, 'Block is already done');
      const otherActive = current.blocks.find((b) => b.id !== block.id && b.status === 'active');
      if (otherActive) throw new HttpError(409, `Finish or skip “${otherActive.title}” before starting another timer`);
      if (block.status !== 'active') {
        block.status = 'active';
        block.startedAt = now;
      } else if (block.startedAt == null) {
        block.startedAt = now;
      }
    } else if (action === 'skip') {
      if (block.status !== 'done') {
        block.status = 'skipped';
        delete block.startedAt;
      }
    } else if (action === 'move') {
      if (block.status === 'done') throw new HttpError(409, 'Block is already done');
      const endHour = (startHour as number) + block.minutes / 60;
      if (endHour > 22) throw new HttpError(400, 'Choose a slot that finishes by 22:00');
      const clash = current.blocks.find((b) => b.id !== block.id && b.status !== 'skipped' && b.status !== 'done'
        && (startHour as number) < b.start + b.minutes / 60 && endHour > b.start);
      if (clash) throw new HttpError(409, `That slot overlaps “${clash.title}”. Choose another time`);
      block.start = startHour as number;
      if (block.status === 'skipped') block.status = 'planned';
      current.blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    } else if (block.status !== 'done') {
      // done — exactly once
      let logged = 0;
      if (block.startedAt != null) {
        logged = Math.min(MAX_LOGGED_MINUTES, Math.round((now - block.startedAt) / 60000));
        if (logged >= 1) {
          const r = await tx.run(
            'INSERT INTO time_logs (user_id, date, category, minutes, note) VALUES (?, ?, ?, ?, ?)',
            userId, date, timeCategoryFor(block), logged, `Plan: ${block.title}`
          );
          block.timeLogId = Number(r.lastInsertRowid);
        } else {
          logged = 0;
        }
      }
      block.loggedMinutes = logged;
      const taskIds = block.taskId != null ? [block.taskId] : block.taskIds ?? [];
      for (const id of taskIds) {
        await tx.run(
          `UPDATE tasks SET status = 'completed', completed_at = ?, date = ?
           WHERE id = ? AND user_id = ? AND status != 'completed'`,
          new Date(now).toISOString(), date, id, userId
        );
      }
      if (block.habitId != null) {
        const habit = await tx.get<any>('SELECT id FROM habits WHERE id = ? AND user_id = ?', block.habitId, userId);
        if (habit) {
          const rank = { bronze: 1, silver: 2, gold: 3 } as Record<string, number>;
          const prev = await tx.get<any>('SELECT completed, tier FROM habit_logs WHERE habit_id = ? AND date = ?', block.habitId, date);
          const tier = block.tier ?? 'silver';
          const keepTier = prev && Number(prev.completed) === 1 && (rank[prev.tier] ?? 0) >= rank[tier] ? prev.tier : tier;
          await tx.run(
            `INSERT INTO habit_logs (user_id, habit_id, date, completed, tier) VALUES (?, ?, ?, 1, ?)
             ON CONFLICT(habit_id, date) DO UPDATE SET completed = 1, tier = excluded.tier`,
            userId, block.habitId, date, keepTier
          );
        }
      }
      block.status = 'done';
      block.completedAt = now;
      delete block.startedAt;
    }

    const isSkipped = block.status === 'skipped';
    if (isSkipped !== wasSkipped) current.deferred = Math.max(0, current.deferred + (isSkipped ? linkedOpen : -linkedOpen));
    current.why = current.why.replace(/ \d+ tasks? waits? for tomorrow, no guilt\.$/, '');
    if (current.deferred > 0) current.why += ` ${current.deferred} task${current.deferred === 1 ? ' waits' : 's wait'} for tomorrow, no guilt.`;
    await savePlan(tx, userId, current);
    return hydrate((await readRow(tx, userId, date))!);
  });
  res.json(await reconcile(userId, plan));
}));

export default router;
