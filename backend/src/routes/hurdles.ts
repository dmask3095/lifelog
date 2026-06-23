import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const hurdles = await db.all('SELECT * FROM hurdles WHERE user_id = ? ORDER BY created_at DESC', req.userId);
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
  if (!task_id || !description) {
    return res.status(400).json({ error: 'task_id and description are required' });
  }
  const task = await db.get('SELECT id FROM tasks WHERE id = ? AND user_id = ?', task_id, req.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = await db.run(
    'INSERT INTO hurdles (user_id, task_id, description) VALUES (?, ?, ?)',
    req.userId, task_id, description
  );
  const hurdle = await db.get('SELECT * FROM hurdles WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(hurdle);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM hurdles WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
