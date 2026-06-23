import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const moods = date
    ? await db.all('SELECT * FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC', req.userId, date)
    : await db.all('SELECT * FROM moods WHERE user_id = ? ORDER BY date DESC', req.userId);
  res.json(moods);
});

router.post('/', async (req: Request, res: Response) => {
  const { date, score, note } = req.body;
  if (!date || !score) return res.status(400).json({ error: 'date and score required' });
  const result = await db.run('INSERT INTO moods (user_id, date, score, note) VALUES (?, ?, ?, ?)', req.userId, date, score, note ?? null);
  res.status(201).json(await db.get('SELECT * FROM moods WHERE id = ?', result.lastInsertRowid));
});

export default router;
