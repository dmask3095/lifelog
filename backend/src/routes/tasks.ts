import { Router, Request, Response } from 'express';
import db, { withTransaction, TASK_POOLS, ENERGY_TAGS, TASK_PRIORITIES, TASK_STATUSES } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

const priorityOrder = `
  CASE priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END
`;

const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

// GET /api/tasks?date=YYYY-MM-DD
// Open tasks carry forward until they are done, triaged into the Someday vault, or dropped.
// Completed tasks show on the day they were completed (PATCH moves `date` on completion).
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { date } = req.query;
  const tasks = date
    ? await db.all(`
        SELECT * FROM tasks
        WHERE user_id = ? AND pool IN ('today','scheduled')
          AND ((status != 'completed' AND date <= ?) OR date = ?)
        ORDER BY ${priorityOrder}, date ASC, id DESC
      `, userId, date, date)
    : await db.all(`SELECT * FROM tasks WHERE user_id = ? ORDER BY date DESC, ${priorityOrder}, id DESC`, userId);
  res.json(tasks);
});

// GET /api/tasks/someday — the Someday vault (parked, never shamed).
router.get('/someday', async (req: Request, res: Response) => {
  const tasks = await db.all(
    `SELECT * FROM tasks WHERE user_id = ? AND pool = 'someday' AND status != 'completed' ORDER BY ${priorityOrder}, id DESC`,
    req.userId
  );
  res.json(tasks);
});

router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { title, description, priority, date, energy_tag, pool, scheduled_for, parent_task_id } = req.body;
  if (!title || !isIsoDate(date)) {
    return res.status(400).json({ error: 'title and date (YYYY-MM-DD) are required' });
  }
  const result = await db.run(
    `INSERT INTO tasks (user_id, title, description, priority, date, energy_tag, pool, scheduled_for, parent_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    String(title).trim(),
    description ?? null,
    oneOf(TASK_PRIORITIES, priority) ? priority : 'medium',
    date,
    oneOf(ENERGY_TAGS, energy_tag) ? energy_tag : 'quick',
    oneOf(TASK_POOLS, pool) ? pool : 'today',
    isIsoDate(scheduled_for) ? scheduled_for : null,
    parent_task_id ?? null
  );
  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', result.lastInsertRowid, userId);
  res.status(201).json(task);
});

// POST /api/tasks/:id/split — break a stuck task into micro-steps.
router.post('/:id/split', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const steps: unknown = req.body.steps;
  const date = isIsoDate(req.body.date) ? req.body.date : null;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 8 || !steps.every((s) => typeof s === 'string' && s.trim())) {
    return res.status(400).json({ error: 'steps must be 1-8 non-empty strings' });
  }
  const parent = await db.get<any>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', req.params.id, userId);
  if (!parent) return res.status(404).json({ error: 'Task not found' });

  const created = await withTransaction(async (tx) => {
    const rows: any[] = [];
    for (const step of steps as string[]) {
      const r = await tx.run(
        `INSERT INTO tasks (user_id, title, priority, date, energy_tag, pool, parent_task_id)
         VALUES (?, ?, ?, ?, 'quick', 'today', ?)`,
        userId, step.trim(), parent.priority, date ?? parent.date, parent.id
      );
      rows.push(await tx.get('SELECT * FROM tasks WHERE id = ?', r.lastInsertRowid));
    }
    await tx.run("UPDATE tasks SET status = CASE WHEN status = 'completed' THEN status ELSE 'ongoing' END WHERE id = ?", parent.id);
    return rows;
  });
  res.status(201).json(created);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { status, priority, title, description, pool, scheduled_for, energy_tag, date } = req.body;
  const task = await db.get<any>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', req.params.id, userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (status !== undefined && !oneOf(TASK_STATUSES, status)) return res.status(400).json({ error: 'invalid status' });
  if (priority !== undefined && !oneOf(TASK_PRIORITIES, priority)) return res.status(400).json({ error: 'invalid priority' });
  if (pool !== undefined && !oneOf(TASK_POOLS, pool)) return res.status(400).json({ error: 'invalid pool' });
  if (energy_tag !== undefined && !oneOf(ENERGY_TAGS, energy_tag)) return res.status(400).json({ error: 'invalid energy_tag' });
  if (scheduled_for !== undefined && scheduled_for !== null && !isIsoDate(scheduled_for)) return res.status(400).json({ error: 'invalid scheduled_for' });
  if (date !== undefined && !isIsoDate(date)) return res.status(400).json({ error: 'invalid date' });

  // Completing a carried-over task moves it onto the day it was actually finished, so the
  // Day view and the weekly series credit the right day. Reopening clears completed_at.
  let nextDate: string | null = date ?? null;
  let completedAt: string | null | undefined = undefined;
  if (status === 'completed' && task.status !== 'completed') completedAt = new Date().toISOString();
  if (status !== undefined && status !== 'completed' && task.status === 'completed') completedAt = null;
  if (pool === 'scheduled' && scheduled_for) nextDate = scheduled_for;
  if (pool === 'today' && !nextDate && task.pool !== 'today') nextDate = task.date;

  await db.run(
    `UPDATE tasks SET
       status = COALESCE(?, status),
       priority = COALESCE(?, priority),
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       pool = COALESCE(?, pool),
       scheduled_for = CASE WHEN ? = 1 THEN ? ELSE scheduled_for END,
       energy_tag = COALESCE(?, energy_tag),
       date = COALESCE(?, date),
       completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END
     WHERE id = ? AND user_id = ?`,
    status ?? null,
    priority ?? null,
    title !== undefined ? String(title).trim() : null,
    description ?? null,
    pool ?? null,
    scheduled_for !== undefined ? 1 : 0,
    scheduled_for ?? null,
    energy_tag ?? null,
    nextDate,
    completedAt !== undefined ? 1 : 0,
    completedAt ?? null,
    req.params.id,
    userId
  );

  res.json(await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', req.params.id, userId));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
