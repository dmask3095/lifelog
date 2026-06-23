import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const logs = date
    ? await db.all('SELECT * FROM body_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC', req.userId, date)
    : await db.all('SELECT * FROM body_logs WHERE user_id = ? ORDER BY date DESC, created_at DESC', req.userId);
  res.json(logs);
});

router.get('/summary/:date', async (req: Request, res: Response) => {
  const summary = await db.all(`
    SELECT type, COUNT(*) as count, SUM(duration_minutes) as total_minutes
    FROM body_logs
    WHERE user_id = ? AND date = ?
    GROUP BY type
  `, req.userId, req.params.date);
  res.json(summary);
});

router.post('/', async (req: Request, res: Response) => {
  const { date, type, time, duration_minutes, note } = req.body;
  if (!date || !type) {
    return res.status(400).json({ error: 'date and type are required' });
  }
  const result = await db.run(
    'INSERT INTO body_logs (user_id, date, type, time, duration_minutes, note) VALUES (?, ?, ?, ?, ?, ?)',
    req.userId, date, type, time ?? null, duration_minutes ?? null, note ?? null
  );
  const log = await db.get('SELECT * FROM body_logs WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(log);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM body_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
