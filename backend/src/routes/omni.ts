import { Router, Request, Response } from 'express';
import { withTransaction } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { parseOmni } from '../lib/omni-parser';
import { applyOmniPlan } from '../lib/omni-apply';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

// POST /api/omni-log { text, date, commit }
// commit=false (default) returns the parsed plan only; commit=true writes it atomically.
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { text, date, commit } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  if (!isIsoDate(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
  if (text.length > 2000) return res.status(400).json({ error: 'keep it under 2000 characters' });

  const plan = parseOmni(text);
  if (!commit) return res.json({ plan, applied: [] });

  const applied = await withTransaction((tx) => applyOmniPlan(tx, userId, date, plan));
  res.json({ plan, applied });
});

export default router;
