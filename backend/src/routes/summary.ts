import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { buildMealIdeas, type GroceryItem } from '../lib/grocery-utils';

const router = Router();
router.use(requireAuth);

router.get('/:date', async (req: Request, res: Response) => {
  const { date } = req.params;
  const userId = req.userId;

  // Matches the carry-forward behavior in routes/tasks.ts: an incomplete task from
  // an earlier date still counts as part of "today" until it's done.
  const [tasks, hurdles, timeLogs, healthLogs, bodyLogs, groceries] = await Promise.all([
    db.all<any>(`
      SELECT * FROM tasks
      WHERE user_id = ? AND (date = ? OR (date < ? AND status != 'completed'))
    `, userId, date, date),
    db.all<any>(`
      SELECT h.*, t.title as task_title
      FROM hurdles h
      JOIN tasks t ON h.task_id = t.id
      WHERE h.user_id = ? AND (t.date = ? OR (t.date < ? AND t.status != 'completed'))
    `, userId, date, date),
    db.all<any>('SELECT * FROM time_logs WHERE user_id = ? AND date = ?', userId, date),
    db.all<any>('SELECT * FROM health_logs WHERE user_id = ? AND date = ?', userId, date),
    db.all<any>('SELECT * FROM body_logs WHERE user_id = ? AND date = ?', userId, date),
    db.all<GroceryItem>(`
      SELECT *
      FROM groceries
      WHERE user_id = ? AND status != 'finished'
      ORDER BY updated_at DESC, name COLLATE NOCASE ASC
    `, userId),
  ]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
  const ongoingTasks = tasks.filter((t: any) => t.status === 'ongoing').length;
  const needsAttention = tasks.filter((t: any) => t.status === 'needs_attention').length;
  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const timeByCategory = timeLogs.reduce((acc: any, log: any) => {
    acc[log.category] = (acc[log.category] || 0) + log.minutes;
    return acc;
  }, {});

  const totalWater = healthLogs.reduce((sum: number, h: any) => sum + (h.water_ml || 0), 0);
  const waterGoalPercent = Math.min(100, Math.round((totalWater / 2500) * 100));
  const foodNotes = healthLogs.map((h: any) => h.food_notes).filter(Boolean);
  const fruits = healthLogs.map((h: any) => h.fruits).filter(Boolean);

  const sleepLogs = bodyLogs.filter((b: any) => b.type === 'sleep');
  const totalSleepMinutes = sleepLogs.reduce((sum: number, b: any) => sum + (b.duration_minutes || 0), 0);
  const peeCount = bodyLogs.filter((b: any) => b.type === 'pee').length;

  const healthScore = Math.round(
    (waterGoalPercent * 0.5) +
    (fruits.length > 0 ? 25 : 0) +
    (totalSleepMinutes >= 420 ? 25 : Math.round((totalSleepMinutes / 420) * 25))
  );

  const groceryIdeas = buildMealIdeas(groceries);
  const eatAsap = groceries.filter(item => item.status === 'eat_asap');
  const cookSoon = groceries.filter(item => item.status === 'cook_soon');
  const cooked = groceries.filter(item => item.status === 'cooked' || item.category === 'leftover');

  const overview = (items: GroceryItem[]) =>
    items.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit }));

  res.json({
    date,
    tasks: { total: totalTasks, completed: completedTasks, ongoing: ongoingTasks, needsAttention, productivityScore, items: tasks },
    hurdles,
    time: { byCategory: timeByCategory, totalMinutes: Object.values(timeByCategory).reduce((a: any, b: any) => a + b, 0) },
    health: { totalWater, waterGoalPercent, foodNotes, fruits, healthScore },
    body: { totalSleepMinutes, sleepHours: +(totalSleepMinutes / 60).toFixed(1), peeCount },
    groceries: {
      total: groceries.length,
      eatAsapCount: eatAsap.length,
      cookSoonCount: cookSoon.length,
      cookedCount: cooked.length,
      eatAsapItems: eatAsap.slice(0, 5),
      mealIdeas: groceryIdeas,
      byCategory: {
        tracked: overview(groceries),
        eatAsap: overview(eatAsap),
        cookSoon: overview(cookSoon),
        cooked: overview(cooked),
      },
    },
  });
});

export default router;
