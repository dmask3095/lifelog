import type { DbHandle } from '../database';
import { eachDate, weekday } from './dates';
import type { DayPoint } from './insights';

export interface HabitStat {
  id: number;
  name: string;
  icon: string;
  kept: number;
  possible: number;
}

export interface SeriesResult {
  days: DayPoint[];
  habitStats: HabitStat[];
  activeHabits: number;
}

export async function loadDayPoints(db: DbHandle, userId: number, start: string, end: string): Promise<SeriesResult> {
  const [taskRows, sleepRows, healthRows, moodRows, habits, habitLogRows, timeRows, hurdleRows, journalRows] = await Promise.all([
    db.all<any>(
      `SELECT date, status, COUNT(*) AS c FROM tasks
       WHERE user_id = ? AND date BETWEEN ? AND ? AND pool IN ('today','scheduled','dropped')
       GROUP BY date, status`,
      userId, start, end
    ),
    db.all<any>(
      `SELECT date, SUM(duration_minutes) AS m FROM body_logs
       WHERE user_id = ? AND type = 'sleep' AND date BETWEEN ? AND ? GROUP BY date`,
      userId, start, end
    ),
    db.all<any>(
      `SELECT date, water_ml, tags, fruits FROM health_logs
       WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC, created_at ASC, id ASC`,
      userId, start, end
    ),
    db.all<any>(
      `SELECT date, score FROM moods
       WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC, created_at ASC, id ASC`,
      userId, start, end
    ),
    db.all<any>('SELECT id, name, icon, created_at FROM habits WHERE user_id = ? AND is_active = 1', userId),
    db.all<any>(
      `SELECT habit_id, date FROM habit_logs
       WHERE user_id = ? AND completed = 1 AND date BETWEEN ? AND ?`,
      userId, start, end
    ),
    db.all<any>(
      `SELECT date, category, SUM(minutes) AS m FROM time_logs
       WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date, category`,
      userId, start, end
    ),
    db.all<any>(
      `SELECT t.date AS d, COUNT(*) AS c FROM hurdles h JOIN tasks t ON h.task_id = t.id
       WHERE h.user_id = ? AND t.date BETWEEN ? AND ? GROUP BY t.date`,
      userId, start, end
    ),
    db.all<any>('SELECT date FROM journal_entries WHERE user_id = ? AND date BETWEEN ? AND ?', userId, start, end),
  ]);

  const tasksTotal = new Map<string, number>();
  const tasksDone = new Map<string, number>();
  for (const r of taskRows) {
    tasksTotal.set(r.date, (tasksTotal.get(r.date) ?? 0) + Number(r.c));
    if (r.status === 'completed') tasksDone.set(r.date, (tasksDone.get(r.date) ?? 0) + Number(r.c));
  }
  const sleep = new Map<string, number>(sleepRows.map((r: any) => [r.date, Number(r.m)]));
  const water = new Map<string, number>();
  for (const r of healthRows) water.set(r.date, Number(r.water_ml) || 0); // last row per date wins
  const mood = new Map<string, number>();
  for (const r of moodRows) mood.set(r.date, Number(r.score));
  const habitsDone = new Map<string, number>();
  const keptPerHabit = new Map<number, number>();
  for (const r of habitLogRows) {
    habitsDone.set(r.date, (habitsDone.get(r.date) ?? 0) + 1);
    keptPerHabit.set(r.habit_id, (keptPerHabit.get(r.habit_id) ?? 0) + 1);
  }
  const time = new Map<string, Record<string, number>>();
  for (const r of timeRows) {
    const bucket = time.get(r.date) ?? {};
    bucket[r.category] = Number(r.m);
    time.set(r.date, bucket);
  }
  const hurdles = new Map<string, number>(hurdleRows.map((r: any) => [r.d, Number(r.c)]));
  const journaled = new Set<string>(journalRows.map((r: any) => r.date));

  const activeHabits = habits.length;
  const days: DayPoint[] = eachDate(start, end).map((date) => {
    const total = tasksTotal.get(date) ?? 0;
    const done = tasksDone.get(date) ?? 0;
    const t = time.get(date) ?? {};
    const habitsKept = habitsDone.get(date) ?? 0;
    const sleepMinutes = sleep.get(date) ?? null;
    const moodScore = mood.get(date) ?? null;
    const waterMl = water.get(date) ?? 0;
    const logged = total > 0 || sleepMinutes != null || moodScore != null || waterMl > 0 || habitsKept > 0 || Object.keys(t).length > 0 || journaled.has(date);
    return {
      date,
      weekday: weekday(date),
      tasksTotal: total,
      tasksCompleted: done,
      productivity: total > 0 ? Math.round((done / total) * 100) : null,
      sleepMinutes,
      waterMl,
      mood: moodScore,
      habitsPct: activeHabits > 0 && logged ? Math.round((habitsKept / activeHabits) * 100) : null,
      deepWorkMin: t.deep_work ?? 0,
      wastedMin: t.wasted ?? 0,
      exerciseMin: t.exercise ?? 0,
      hurdles: hurdles.get(date) ?? 0,
      journaled: journaled.has(date),
      logged,
    };
  });

  const span = days.length;
  const habitStats: HabitStat[] = habits.map((h: any) => ({
    id: h.id,
    name: h.name,
    icon: h.icon,
    kept: keptPerHabit.get(h.id) ?? 0,
    possible: span,
  }));

  return { days, habitStats, activeHabits };
}
