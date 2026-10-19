import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const open = req.query.open === '1';
  const hurdles = await db.all(
    `SELECT h.*, t.title AS task_title FROM hurdles h JOIN tasks t ON h.task_id = t.id
     WHERE h.user_id = ? ${open ? 'AND h.resolved_at IS NULL' : ''} ORDER BY h.created_at DESC`,
    req.userId
  );
  res.json(hurdles);
});

router.get('/task/:taskId', async (req: Request, res: Response) => {
  const hurdles = await db.all(
    'SELECT * FROM hurdles WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC',
    req.params.taskId, req.userId
  );
  res.json(hurdles);
});

router.post('/', async (req: Request, res: Response) => {
  const { task_id, description } = req.body;
  if (!task_id || !description || !String(description).trim()) {
    return res.status(400).json({ error: 'task_id and description are required' });
  }
  const task = await db.get('SELECT id FROM tasks WHERE id = ? AND user_id = ?', task_id, req.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = await db.run(
    'INSERT INTO hurdles (user_id, task_id, description) VALUES (?, ?, ?)',
    req.userId, task_id, String(description).trim()
  );
  await db.run("UPDATE tasks SET status = 'needs_attention' WHERE id = ? AND user_id = ? AND status != 'completed'", task_id, req.userId);
  const hurdle = await db.get('SELECT * FROM hurdles WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(hurdle);
});

// PATCH /api/hurdles/:id — resolve a hurdle (optionally with what unblocked it).
router.patch('/:id', async (req: Request, res: Response) => {
  const { resolution, reopen } = req.body;
  const hurdle = await db.get<any>('SELECT * FROM hurdles WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!hurdle) return res.status(404).json({ error: 'Hurdle not found' });
  if (reopen) {
    await db.run('UPDATE hurdles SET resolved_at = NULL, resolution = NULL WHERE id = ?', hurdle.id);
  } else {
    await db.run('UPDATE hurdles SET resolved_at = CURRENT_TIMESTAMP, resolution = ? WHERE id = ?', resolution ?? null, hurdle.id);
    const remaining = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM hurdles WHERE task_id = ? AND resolved_at IS NULL', hurdle.task_id
    );
    if (!remaining || Number(remaining.c) === 0) {
      await db.run("UPDATE tasks SET status = 'ongoing' WHERE id = ? AND status = 'needs_attention'", hurdle.task_id);
    }
  }
  res.json(await db.get('SELECT * FROM hurdles WHERE id = ?', hurdle.id));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM hurdles WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
