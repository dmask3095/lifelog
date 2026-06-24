import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const priorityOrder = `
    CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END
  `;
  // Incomplete tasks from earlier dates carry forward into "today" instead of
  // silently disappearing once their original date has passed.
  const tasks = date
    ? await db.all(`
        SELECT * FROM tasks
        WHERE user_id = ? AND (date = ? OR (date < ? AND status != 'completed'))
        ORDER BY ${priorityOrder}, date ASC, id DESC
      `, req.userId, date, date)
    : await db.all(`SELECT * FROM tasks WHERE user_id = ? ORDER BY date DESC, ${priorityOrder}, id DESC`, req.userId);
  res.json(tasks);
});

router.post('/', async (req: Request, res: Response) => {
  const { title, description, priority, date } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: 'title and date are required' });
  }
  const result = await db.run(
    'INSERT INTO tasks (user_id, title, description, priority, date) VALUES (?, ?, ?, ?, ?)',
    req.userId, title, description ?? null, priority ?? 'medium', date
  );

  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', result.lastInsertRowid, req.userId);
  res.status(201).json(task);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { status, priority, title } = req.body;
  const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  await db.run(
    'UPDATE tasks SET status = COALESCE(?, status), priority = COALESCE(?, priority), title = COALESCE(?, title) WHERE id = ? AND user_id = ?',
    status ?? null, priority ?? null, title ?? null, req.params.id, req.userId
  );

  res.json(await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', req.params.id, req.userId));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
