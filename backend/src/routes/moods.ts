import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const moods = date
    ? await db.all('SELECT * FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC', req.userId, date)
    : await db.all('SELECT * FROM moods WHERE user_id = ? ORDER BY date DESC, created_at DESC', req.userId);
  res.json(moods);
});

router.get('/latest/:date', async (req: Request, res: Response) => {
  const row = await db.get('SELECT * FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', req.userId, req.params.date);
  res.json(row ?? null);
});

// POST /api/moods — one check-in per day; saving again updates it instead of duplicating.
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { date, score, note } = req.body;
  const s = Number(score);
  if (!isIsoDate(date) || !Number.isInteger(s) || s < 1 || s > 5) {
    return res.status(400).json({ error: 'date and a score from 1 to 5 are required' });
  }
  const existing = await db.get<any>('SELECT id FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date);
  if (existing) {
    await db.run('UPDATE moods SET score = ?, note = ? WHERE id = ?', s, note ?? null, existing.id);
    return res.json(await db.get('SELECT * FROM moods WHERE id = ?', existing.id));
  }
  const result = await db.run('INSERT INTO moods (user_id, date, score, note) VALUES (?, ?, ?, ?)', userId, date, s, note ?? null);
  res.status(201).json(await db.get('SELECT * FROM moods WHERE id = ?', result.lastInsertRowid));
});

export default router;
