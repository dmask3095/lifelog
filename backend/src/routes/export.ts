import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

const TABLES = ['tasks', 'hurdles', 'habits', 'habit_logs', 'time_logs', 'health_logs', 'body_logs', 'moods', 'journal_entries', 'streaks', 'groceries', 'day_plans'];

// GET /api/export — everything you ever logged, as one JSON document. Free forever.
router.get('/', async (req: Request, res: Response) => {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    out[table] = await db.all(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY id ASC`, req.userId);
  }
  res.setHeader('Content-Disposition', `attachment; filename="lifelog-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), version: 2, data: out });
});

export default router;
