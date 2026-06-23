import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const { date } = req.query;
  const logs = date
    ? await db.all('SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC', req.userId, date)
    : await db.all('SELECT * FROM health_logs WHERE user_id = ? ORDER BY date DESC', req.userId);
  res.json(logs);
});

router.post('/', async (req: Request, res: Response) => {
  const { date, water_ml, fruits, food_notes } = req.body;
  if (!date) {
    return res.status(400).json({ error: 'date is required' });
  }
  const result = await db.run(
    'INSERT INTO health_logs (user_id, date, water_ml, fruits, food_notes) VALUES (?, ?, ?, ?, ?)',
    req.userId, date, water_ml ?? 0, fruits ?? null, food_notes ?? null
  );
  const log = await db.get('SELECT * FROM health_logs WHERE id = ?', result.lastInsertRowid);
  res.status(201).json(log);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { water_ml, fruits, food_notes } = req.body;
  const existing = await db.get('SELECT * FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Log not found' });

  await db.run(`
    UPDATE health_logs
    SET water_ml = COALESCE(?, water_ml),
        fruits = COALESCE(?, fruits),
        food_notes = COALESCE(?, food_notes)
    WHERE id = ? AND user_id = ?
  `, water_ml ?? null, fruits ?? null, food_notes ?? null, req.params.id, req.userId);

  res.json(await db.get('SELECT * FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM health_logs WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
