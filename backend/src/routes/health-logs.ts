import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

const FUEL_TAGS = ['protein', 'produce', 'caffeine', 'sugar', 'alcohol', 'junk'];

function cleanTags(raw: unknown): string | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const tags = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter((t) => FUEL_TAGS.includes(t)))];
  return tags.length ? tags.join(',') : null;
}

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const logs = date
    ? await db.all('SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC', req.userId, date)
    : await db.all('SELECT * FROM health_logs WHERE user_id = ? ORDER BY date DESC, created_at DESC', req.userId);
  res.json(logs);
});

// GET /api/health-logs/latest/:date — the one row the Fuel panel hydrates from.
router.get('/latest/:date', async (req: Request, res: Response) => {
  const row = await db.get('SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', req.userId, req.params.date);
  res.json(row ?? null);
});

// POST /api/health-logs — idempotent per (user, date). `water_ml` sets the day's total,
// `add_water_ml` increments it. Fixes the v1 bug where every save inserted a new row.
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { date, water_ml, add_water_ml, fruits, food_notes, tags } = req.body;
  if (!isIsoDate(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });

  const existing = await db.get<any>('SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date);
  let water = existing?.water_ml ?? 0;
  if (water_ml !== undefined && water_ml !== null) water = Math.max(0, Number(water_ml) || 0);
  if (add_water_ml) water = Math.max(0, water + (Number(add_water_ml) || 0));
  const nextTags = tags !== undefined ? cleanTags(tags) : (existing?.tags ?? null);

  if (existing) {
    await db.run(
      'UPDATE health_logs SET water_ml = ?, fruits = COALESCE(?, fruits), food_notes = COALESCE(?, food_notes), tags = ? WHERE id = ?',
      water, fruits ?? null, food_notes ?? null, nextTags, existing.id
    );
    return res.json(await db.get('SELECT * FROM health_logs WHERE id = ?', existing.id));
  }
  const result = await db.run(
    'INSERT INTO health_logs (user_id, date, water_ml, fruits, food_notes, tags) VALUES (?, ?, ?, ?, ?, ?)',
    userId, date, water, fruits ?? null, food_notes ?? null, nextTags
  );
  res.status(201).json(await db.get('SELECT * FROM health_logs WHERE id = ?', result.lastInsertRowid));
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { water_ml, fruits, food_notes, tags } = req.body;
  const existing = await db.get('SELECT * FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Log not found' });
  await db.run(`
    UPDATE health_logs
    SET water_ml = COALESCE(?, water_ml), fruits = COALESCE(?, fruits), food_notes = COALESCE(?, food_notes),
        tags = CASE WHEN ? = 1 THEN ? ELSE tags END
    WHERE id = ? AND user_id = ?
  `, water_ml ?? null, fruits ?? null, food_notes ?? null, tags !== undefined ? 1 : 0, cleanTags(tags), req.params.id, req.userId);
  res.json(await db.get('SELECT * FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
