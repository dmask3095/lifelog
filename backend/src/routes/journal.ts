import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/:date', async (req: Request, res: Response) => {
  const entry = await db.get('SELECT * FROM journal_entries WHERE user_id = ? AND date = ?', req.userId, req.params.date);
  res.json(entry ?? null);
});

router.post('/', async (req: Request, res: Response) => {
  const { date, content } = req.body;
  if (!date || !content) return res.status(400).json({ error: 'date and content required' });
  await db.run(`
    INSERT INTO journal_entries (user_id, date, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, date) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `, req.userId, date, content);
  res.json(await db.get('SELECT * FROM journal_entries WHERE user_id = ? AND date = ?', req.userId, date));
});

router.get('/', async (req: Request, res: Response) => {
  const entries = await db.all('SELECT date, content, updated_at FROM journal_entries WHERE user_id = ? ORDER BY date DESC', req.userId);
  res.json(entries);
});

export default router;
