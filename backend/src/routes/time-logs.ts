import { Router, Request, Response } from 'express';
import db, { withTransaction, TIME_CATEGORIES } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

const validCategory = (c: unknown): c is (typeof TIME_CATEGORIES)[number] =>
  typeof c === 'string' && (TIME_CATEGORIES as readonly string[]).includes(c);

router.get('/categories', (_req: Request, res: Response) => {
  res.json(TIME_CATEGORIES);
});

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const logs = date
    ? await db.all('SELECT * FROM time_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC', req.userId, date)
    : await db.all('SELECT * FROM time_logs WHERE user_id = ? ORDER BY date DESC, created_at DESC', req.userId);
  res.json(logs);
});

router.get('/summary/:date', async (req: Request, res: Response) => {
  const summary = await db.all(`
    SELECT category, SUM(minutes) as total_minutes, MAX(note) as latest_note
    FROM time_logs
    WHERE user_id = ? AND date = ?
    GROUP BY category
  `, req.userId, req.params.date);
  res.json(summary);
});

// PUT /api/time-logs/daily — set the day's total for one category.
router.put('/daily', async (req: Request, res: Response) => {
  const { date, category, minutes, note } = req.body;
  if (!isIsoDate(date) || !validCategory(category) || minutes === undefined || minutes === null) {
    return res.status(400).json({ error: 'date, a valid category, and minutes are required' });
  }
  const normalizedMinutes = Math.max(0, Number(minutes) || 0);
  const result = await withTransaction(async (tx) => {
    await tx.run('DELETE FROM time_logs WHERE date = ? AND category = ? AND user_id = ?', date, category, req.userId);
    return tx.run(
      'INSERT INTO time_logs (user_id, date, category, minutes, note) VALUES (?, ?, ?, ?, ?)',
      req.userId, date, category, normalizedMinutes, note ?? null
    );
  });
  const log = await db.get('SELECT * FROM time_logs WHERE id = ?', result.lastInsertRowid);
  res.json(log);
});

// POST /api/time-logs — append minutes (used by the focus timer and the Omni-Bar).
router.post('/', async (req: Request, res: Response) => {
  const { date, category, minutes, note } = req.body;
  if (!isIsoDate(date) || !validCategory(category) || minutes === undefined || minutes === null) {
    return res.status(400).json({ error: 'date, a valid category, and minutes are required' });
  }
  const result = await db.run(
    'INSERT INTO time_logs (user_id, date, category, minutes, note) VALUES (?, ?, ?, ?, ?)',
    req.userId, date, category, Math.max(0, Number(minutes) || 0), note ?? null
  );
  const log = await db.get('SELECT * FROM time_logs WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(log);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM time_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
