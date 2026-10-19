import { Router, Request, Response } from 'express';
import db, { HABIT_TIERS } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { computeStreak } from '../lib/streaks';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const habits = await db.all('SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY id ASC', req.userId);
  res.json(habits);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, icon, floor_label, target_label, stretch_label } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const result = await db.run(
    'INSERT INTO habits (user_id, name, icon, floor_label, target_label, stretch_label) VALUES (?, ?, ?, ?, ?, ?)',
    req.userId, String(name).trim(), icon || '✓', floor_label || null, target_label || null, stretch_label || null
  );
  res.status(201).json(await db.get('SELECT * FROM habits WHERE id = ?', result.lastInsertRowid));
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { name, icon, floor_label, target_label, stretch_label } = req.body;
  const habit = await db.get('SELECT id FROM habits WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });
  await db.run(
    `UPDATE habits SET
       name = COALESCE(?, name), icon = COALESCE(?, icon),
       floor_label = COALESCE(?, floor_label), target_label = COALESCE(?, target_label), stretch_label = COALESCE(?, stretch_label)
     WHERE id = ? AND user_id = ?`,
    name ?? null, icon ?? null, floor_label ?? null, target_label ?? null, stretch_label ?? null, req.params.id, req.userId
  );
  res.json(await db.get('SELECT * FROM habits WHERE id = ?', req.params.id));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('UPDATE habits SET is_active = 0 WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

// GET /api/habits/log/:date — habits for a day, each with its elastic streak, shields,
// 14-day history and consistency. Streaks are computed from habit_logs and cached in the
// `streaks` table so the number is always derived from the truth.
router.get('/log/:date', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const date = req.params.date;
  if (!isIsoDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  const [habits, logs] = await Promise.all([
    db.all<any>('SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY id ASC', userId),
    db.all<any>('SELECT habit_id, date, tier FROM habit_logs WHERE user_id = ? AND completed = 1 AND date <= ?', userId, date),
  ]);
  const byHabit = new Map<number, Map<string, string>>();
  for (const l of logs) {
    const m = byHabit.get(l.habit_id) ?? new Map<string, string>();
    m.set(l.date, l.tier || 'silver');
    byHabit.set(l.habit_id, m);
  }

  const result = [];
  for (const h of habits) {
    const kept = byHabit.get(h.id) ?? new Map<string, string>();
    const streak = computeStreak(kept, String(h.created_at).slice(0, 10), date, Number(h.grace_shields ?? 1));
    await db.run(
      `INSERT INTO streaks (user_id, metric, current_streak, longest_streak, last_logged_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, metric) DO UPDATE SET
         current_streak = excluded.current_streak,
         longest_streak = excluded.longest_streak,
         last_logged_date = excluded.last_logged_date`,
      userId, `habit:${h.id}`, streak.currentStreak, streak.longestStreak, [...kept.keys()].sort().pop() ?? null
    );
    result.push({
      ...h,
      completed: kept.has(date),
      tier: kept.get(date) ?? null,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      shields: streak.shields,
      totalKept: streak.totalKept,
      consistency14: streak.consistency14,
      history14: streak.history14,
    });
  }
  res.json(result);
});

router.post('/log', async (req: Request, res: Response) => {
  const { habit_id, date, completed, tier } = req.body;
  if (!isIsoDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const habit = await db.get('SELECT id FROM habits WHERE id = ? AND user_id = ?', habit_id, req.userId);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });
  const safeTier = (HABIT_TIERS as readonly string[]).includes(tier) ? tier : 'silver';

  await db.run(`
    INSERT INTO habit_logs (user_id, habit_id, date, completed, tier) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed, tier = excluded.tier
  `, req.userId, habit_id, date, completed ? 1 : 0, safeTier);
  res.json({ ok: true });
});

export default router;
