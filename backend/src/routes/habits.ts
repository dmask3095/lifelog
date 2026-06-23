import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const habits = await db.all('SELECT * FROM habits WHERE user_id = ? AND is_active = 1', req.userId);
  res.json(habits);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = await db.run('INSERT INTO habits (user_id, name, icon) VALUES (?, ?, ?)', req.userId, name, icon ?? '✓');
  res.status(201).json(await db.get('SELECT * FROM habits WHERE id = ?', result.lastInsertRowid));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('UPDATE habits SET is_active = 0 WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

router.get('/log/:date', async (req: Request, res: Response) => {
  const habits = await db.all<any>('SELECT * FROM habits WHERE user_id = ? AND is_active = 1', req.userId);
  const logs = await db.all<any>('SELECT * FROM habit_logs WHERE user_id = ? AND date = ?', req.userId, req.params.date);
  const result = habits.map(h => ({
    ...h,
    completed: logs.some((l: any) => l.habit_id === h.id && l.completed === 1),
  }));
  res.json(result);
});

router.post('/log', async (req: Request, res: Response) => {
  const { habit_id, date, completed } = req.body;
  const habit = await db.get('SELECT id FROM habits WHERE id = ? AND user_id = ?', habit_id, req.userId);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  await db.run(`
    INSERT INTO habit_logs (user_id, habit_id, date, completed) VALUES (?, ?, ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed
  `, req.userId, habit_id, date, completed ? 1 : 0);
  res.json({ ok: true });
});

export default router;
