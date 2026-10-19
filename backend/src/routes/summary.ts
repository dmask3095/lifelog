import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { computeCapacity } from '../lib/capacity';
import { buildInsights } from '../lib/insights';
import { loadDayPoints } from '../lib/series';
import { computeStreak } from '../lib/streaks';
import { isIsoDate, shiftDate, daysBetween } from '../lib/dates';

const router = Router();
router.use(requireAuth);

const PRIORITY_ORDER = `
  CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
`;

function splitTags(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

// GET /api/summary/range?start=YYYY-MM-DD&end=YYYY-MM-DD — the weekly / monthly engine.
router.get('/range', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const start = String(req.query.start ?? '');
  const end = String(req.query.end ?? '');
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    return res.status(400).json({ error: 'start and end must be ISO dates with start <= end' });
  }
  if (daysBetween(start, end) > 120) {
    return res.status(400).json({ error: 'range too large (max 120 days)' });
  }

  const { days, habitStats, activeHabits } = await loadDayPoints(db, userId, start, end);
  const insights = buildInsights(days);

  const logged = days.filter((d) => d.logged);
  const withSleep = days.filter((d) => d.sleepMinutes != null);
  const withMood = days.filter((d) => d.mood != null);
  const withWater = days.filter((d) => d.waterMl > 0);
  const withTasks = days.filter((d) => d.tasksTotal > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const totals = {
    daysInRange: days.length,
    daysLogged: logged.length,
    tasksTotal: days.reduce((a, d) => a + d.tasksTotal, 0),
    tasksCompleted: days.reduce((a, d) => a + d.tasksCompleted, 0),
    avgProductivity: avg(withTasks.map((d) => d.productivity as number)),
    avgSleepMinutes: avg(withSleep.map((d) => d.sleepMinutes as number)),
    avgMood: avg(withMood.map((d) => d.mood as number)),
    avgWaterMl: avg(withWater.map((d) => d.waterMl)),
    deepWorkMinutes: days.reduce((a, d) => a + d.deepWorkMin, 0),
    exerciseMinutes: days.reduce((a, d) => a + d.exerciseMin, 0),
    wastedMinutes: days.reduce((a, d) => a + d.wastedMin, 0),
    hurdles: days.reduce((a, d) => a + d.hurdles, 0),
    journalDays: days.filter((d) => d.journaled).length,
    strongDays: days.filter((d) => (d.productivity ?? 0) >= 70).length,
  };

  const bestHabit = habitStats.length
    ? habitStats.reduce((a, b) => (b.kept / Math.max(1, b.possible) > a.kept / Math.max(1, a.possible) ? b : a))
    : null;
  const bestDay = withTasks.length ? withTasks.reduce((a, b) => ((b.productivity ?? 0) > (a.productivity ?? 0) ? b : a)) : null;
  const topInsight = insights[0] ?? null;

  res.json({
    start,
    end,
    days,
    totals,
    habitStats,
    activeHabits,
    insights,
    wrap: {
      wins: [
        totals.tasksCompleted > 0 ? `${totals.tasksCompleted} tasks shipped across ${withTasks.length} active days` : null,
        totals.strongDays > 0 ? `${totals.strongDays} day${totals.strongDays === 1 ? '' : 's'} at 70%+ completion` : null,
        totals.deepWorkMinutes > 0 ? `${(totals.deepWorkMinutes / 60).toFixed(1)}h of deep work logged` : null,
        totals.avgSleepMinutes != null ? `${(totals.avgSleepMinutes / 60).toFixed(1)}h average sleep` : null,
      ].filter(Boolean),
      bestDay: bestDay ? { date: bestDay.date, productivity: bestDay.productivity } : null,
      bestHabit: bestHabit && bestHabit.kept > 0 ? { name: bestHabit.name, icon: bestHabit.icon, kept: bestHabit.kept, possible: bestHabit.possible } : null,
      topInsight,
      hurdles: totals.hurdles,
      focus: topInsight
        ? `Lean into it: ${topInsight.title.toLowerCase()} is your clearest lever right now.`
        : logged.length < 7
          ? 'Keep logging. Patterns unlock after 7 logged days.'
          : 'Protect one deep-work block before noon on your strongest weekday.',
    },
  });
});

// GET /api/summary/pixels?end=YYYY-MM-DD — a year of mood and completion, one cell per day.
router.get('/pixels', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const end = isIsoDate(req.query.end) ? String(req.query.end) : new Date().toISOString().slice(0, 10);
  const { days } = await loadDayPoints(db, userId, shiftDate(end, -364), end);
  res.json({
    start: shiftDate(end, -364),
    end,
    days: days.map((d) => ({ date: d.date, mood: d.mood, productivity: d.productivity, logged: d.logged })),
    loggedDays: days.filter((d) => d.logged).length,
  });
});

// GET /api/summary/:date — the Day dashboard.
router.get('/:date', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { date } = req.params;
  if (!isIsoDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  const [tasks, hurdles, timeLogs, healthRow, bodyLogs, moodRow, habits, habitLogsAll, journal] = await Promise.all([
    db.all<any>(`
      SELECT * FROM tasks
      WHERE user_id = ? AND pool IN ('today','scheduled')
        AND ((status != 'completed' AND date <= ?) OR date = ?)
      ORDER BY ${PRIORITY_ORDER}, date ASC, id DESC
    `, userId, date, date),
    db.all<any>(`
      SELECT h.*, t.title AS task_title
      FROM hurdles h JOIN tasks t ON h.task_id = t.id
      WHERE h.user_id = ? AND h.resolved_at IS NULL AND t.status != 'completed'
        AND t.pool IN ('today','scheduled') AND t.date <= ?
      ORDER BY h.created_at DESC
    `, userId, date),
    db.all<any>('SELECT * FROM time_logs WHERE user_id = ? AND date = ?', userId, date),
    db.get<any>('SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date),
    db.all<any>('SELECT * FROM body_logs WHERE user_id = ? AND date = ?', userId, date),
    db.get<any>('SELECT * FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date),
    db.all<any>('SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY id ASC', userId),
    db.all<any>('SELECT habit_id, date, tier FROM habit_logs WHERE user_id = ? AND completed = 1 AND date <= ?', userId, date),
    db.get<any>('SELECT content, updated_at FROM journal_entries WHERE user_id = ? AND date = ?', userId, date),
  ]);

  // Tasks
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
  const ongoingTasks = tasks.filter((t: any) => t.status === 'ongoing').length;
  const needsAttention = tasks.filter((t: any) => t.status === 'needs_attention').length;
  const overdue = tasks.filter((t: any) => t.status !== 'completed' && t.date < date);
  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Time
  const timeByCategory = timeLogs.reduce((acc: Record<string, number>, log: any) => {
    acc[log.category] = (acc[log.category] || 0) + Number(log.minutes);
    return acc;
  }, {});
  const totalMinutes = Object.values(timeByCategory).reduce((a: number, b) => a + Number(b), 0);

  // Health / fuel
  const totalWater = Number(healthRow?.water_ml ?? 0);
  const waterGoalPercent = Math.min(100, Math.round((totalWater / 2500) * 100));
  const tags = splitTags(healthRow?.tags);
  if (healthRow?.fruits && !tags.includes('produce')) tags.push('produce');
  const foodNotes = [healthRow?.food_notes].filter(Boolean) as string[];
  const fruits = healthRow?.fruits ? [healthRow.fruits] : [];

  // Body
  const sleepLogs = bodyLogs.filter((b: any) => b.type === 'sleep');
  const totalSleepMinutes = sleepLogs.reduce((sum: number, b: any) => sum + Number(b.duration_minutes || 0), 0);
  const peeCount = bodyLogs.filter((b: any) => b.type === 'pee').length;
  const sleepPercent = Math.min(100, Math.round((totalSleepMinutes / 480) * 100));

  const fuelScore = (tags.includes('produce') ? 50 : 0) + (tags.includes('protein') ? 50 : 0);
  const healthScore = Math.round(
    waterGoalPercent * 0.4 +
    Math.min(100, (totalSleepMinutes / 450) * 100) * 0.35 +
    fuelScore * 0.25
  );

  // Habits + elastic streaks
  const logsByHabit = new Map<number, Map<string, string>>();
  for (const l of habitLogsAll) {
    const m = logsByHabit.get(l.habit_id) ?? new Map<string, string>();
    m.set(l.date, l.tier || 'silver');
    logsByHabit.set(l.habit_id, m);
  }
  const habitItems = habits.map((h: any) => {
    const kept = logsByHabit.get(h.id) ?? new Map<string, string>();
    const streak = computeStreak(kept, String(h.created_at).slice(0, 10), date, Number(h.grace_shields ?? 1));
    return {
      id: h.id,
      name: h.name,
      icon: h.icon,
      completed: kept.has(date),
      tier: kept.get(date) ?? null,
      currentStreak: streak.currentStreak,
      shields: streak.shields,
      consistency14: streak.consistency14,
    };
  });
  const habitsCompleted = habitItems.filter((h: any) => h.completed).length;
  const habitsPct = habits.length > 0 ? Math.round((habitsCompleted / habits.length) * 100) : 0;

  const mood = moodRow ? { score: Number(moodRow.score), note: moodRow.note ?? null } : null;
  const capacity = computeCapacity({
    sleepMinutes: totalSleepMinutes > 0 ? totalSleepMinutes : null,
    moodScore: mood?.score ?? null,
    waterMl: totalWater > 0 ? totalWater : null,
  });

  // Day insight from the trailing 30 days
  const { days } = await loadDayPoints(db, userId, shiftDate(date, -29), date);
  const insights = buildInsights(days);
  const loggedDays = days.filter((d) => d.logged).length;

  // Tomorrow's plan (set by "Close the day") and On-This-Day lookbacks.
  const tomorrowDate = shiftDate(date, 1);
  const tomorrowTasks = await db.all<any>(
    `SELECT id, title, priority, energy_tag, description FROM tasks
     WHERE user_id = ? AND date = ? AND pool IN ('today','scheduled') AND status != 'completed' AND parent_task_id IS NULL
     ORDER BY ${PRIORITY_ORDER}, id ASC`,
    userId, tomorrowDate
  );
  const lookback: Array<{ label: string; date: string; mood: number | null; journal: string | null; tasksCompleted: number }> = [];
  for (const [label, offset] of [['1 week ago', -7], ['1 month ago', -30], ['1 year ago', -365]] as Array<[string, number]>) {
    const d = shiftDate(date, offset);
    const [m, j, t] = await Promise.all([
      db.get<any>('SELECT score FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, d),
      db.get<any>('SELECT content FROM journal_entries WHERE user_id = ? AND date = ?', userId, d),
      db.get<{ c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND date = ? AND status = 'completed'", userId, d),
    ]);
    const done = Number(t?.c ?? 0);
    if (!m && !j && done === 0) continue;
    const snippet = j?.content
      ? String(j.content).split('\n').filter((line: string) => line.trim() && !/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(line.trim())).join(' ').slice(0, 160)
      : null;
    lookback.push({ label, date: d, mood: m ? Number(m.score) : null, journal: snippet, tasksCompleted: done });
  }

  res.json({
    date,
    tasks: {
      total: totalTasks, completed: completedTasks, ongoing: ongoingTasks, needsAttention,
      overdue: overdue.length, productivityScore, items: tasks,
    },
    hurdles,
    time: { byCategory: timeByCategory, totalMinutes },
    health: { totalWater, waterGoalPercent, foodNotes, fruits, tags, healthScore },
    body: { totalSleepMinutes, sleepHours: +(totalSleepMinutes / 60).toFixed(1), sleepPercent, peeCount },
    mood,
    habits: { total: habits.length, completed: habitsCompleted, pct: habitsPct, items: habitItems },
    capacity,
    journal: journal ? { hasEntry: true, noteCount: String(journal.content).split('\n\n').length, updatedAt: journal.updated_at } : { hasEntry: false, noteCount: 0, updatedAt: null },
    insight: insights[0] ?? null,
    insightCount: insights.length,
    loggedDays30: loggedDays,
    tomorrow: { date: tomorrowDate, count: tomorrowTasks.length, items: tomorrowTasks },
    lookback,
  });
});

export default router;
