export interface DayPoint {
  date: string;
  weekday: number;
  tasksTotal: number;
  tasksCompleted: number;
  productivity: number | null;
  sleepMinutes: number | null;
  waterMl: number;
  mood: number | null;
  habitsPct: number | null;
  deepWorkMin: number;
  wastedMin: number;
  exerciseMin: number;
  hurdles: number;
  journaled: boolean;
  logged: boolean;
}

export interface Insight {
  id: string;
  kind: 'split' | 'correlation' | 'weekday';
  title: string;
  detail: string;
  n: number;
  confidence: 'early' | 'solid';
  effect: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 5) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function fmtH(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

interface SplitSpec {
  id: string;
  title: string;
  cond: (d: DayPoint) => boolean | null;
  metric: (d: DayPoint) => number | null;
  fmt: (v: number) => string;
  scale: number;
  phrase: (yes: string, no: string, yesN: number, noN: number) => string;
}

const SPLITS: SplitSpec[] = [
  {
    id: 'sleep-productivity',
    title: 'Sleep → task completion',
    cond: (d) => (d.sleepMinutes == null ? null : d.sleepMinutes >= 420),
    metric: (d) => d.productivity,
    fmt: (v) => `${Math.round(v)}%`,
    scale: 100,
    phrase: (y, n, yn, nn) => `After 7h+ sleep you complete ${y} of your tasks vs ${n} after short sleep (${yn} vs ${nn} days).`,
  },
  {
    id: 'water-mood',
    title: 'Hydration → mood',
    cond: (d) => (d.waterMl > 0 ? d.waterMl >= 1500 : null),
    metric: (d) => d.mood,
    fmt: (v) => `${v.toFixed(1)}/5`,
    scale: 5,
    phrase: (y, n, yn, nn) => `On days with 1.5L+ water your mood averages ${y} vs ${n} on low-water days (${yn} vs ${nn} days).`,
  },
  {
    id: 'deepwork-mood',
    title: 'Deep work → mood',
    cond: (d) => (d.logged ? d.deepWorkMin >= 60 : null),
    metric: (d) => d.mood,
    fmt: (v) => `${v.toFixed(1)}/5`,
    scale: 5,
    phrase: (y, n, yn, nn) => `With a 60m+ deep-work block your mood averages ${y} vs ${n} without one (${yn} vs ${nn} days).`,
  },
  {
    id: 'habits-mood',
    title: 'Habit consistency → mood',
    cond: (d) => (d.habitsPct == null ? null : d.habitsPct >= 70),
    metric: (d) => d.mood,
    fmt: (v) => `${v.toFixed(1)}/5`,
    scale: 5,
    phrase: (y, n, yn, nn) => `When you keep 70%+ of your habits your mood averages ${y} vs ${n} when they slip (${yn} vs ${nn} days).`,
  },
  {
    id: 'sleep-hurdles',
    title: 'Sleep → hurdles',
    cond: (d) => (d.sleepMinutes == null ? null : d.sleepMinutes >= 420),
    metric: (d) => (d.tasksTotal > 0 ? d.hurdles : null),
    fmt: (v) => `${v.toFixed(1)}`,
    scale: 2,
    phrase: (y, n, yn, nn) => `After 7h+ sleep you flag ${y} hurdles a day vs ${n} after short sleep (${yn} vs ${nn} days).`,
  },
  {
    id: 'exercise-productivity',
    title: 'Movement → task completion',
    cond: (d) => (d.logged ? d.exerciseMin >= 20 : null),
    metric: (d) => d.productivity,
    fmt: (v) => `${Math.round(v)}%`,
    scale: 100,
    phrase: (y, n, yn, nn) => `On days with 20m+ of movement you complete ${y} of your tasks vs ${n} on sedentary days (${yn} vs ${nn} days).`,
  },
  {
    id: 'wasted-productivity',
    title: 'Doomscrolling → task completion',
    cond: (d) => (d.logged ? d.wastedMin >= 60 : null),
    metric: (d) => d.productivity,
    fmt: (v) => `${Math.round(v)}%`,
    scale: 100,
    phrase: (y, n, yn, nn) => `On days with 60m+ of scrolling you complete ${y} of your tasks vs ${n} on low-scroll days (${yn} vs ${nn} days).`,
  },
];

export function buildInsights(days: DayPoint[]): Insight[] {
  const out: Insight[] = [];

  for (const spec of SPLITS) {
    const yes: number[] = [];
    const no: number[] = [];
    for (const d of days) {
      const c = spec.cond(d);
      const m = spec.metric(d);
      if (c == null || m == null) continue;
      (c ? yes : no).push(m);
    }
    if (yes.length < 3 || no.length < 3) continue;
    const my = mean(yes);
    const mn = mean(no);
    const effect = (my - mn) / spec.scale;
    if (Math.abs(effect) < 0.08) continue;
    const n = yes.length + no.length;
    out.push({
      id: spec.id,
      kind: 'split',
      title: spec.title,
      detail: spec.phrase(spec.fmt(my), spec.fmt(mn), yes.length, no.length),
      n,
      confidence: Math.min(yes.length, no.length) >= 6 ? 'solid' : 'early',
      effect,
    });
  }

  const corrSpecs: Array<{ id: string; title: string; x: (d: DayPoint) => number | null; y: (d: DayPoint) => number | null; xName: string; yName: string }> = [
    { id: 'corr-sleep-productivity', title: 'Sleep ↔ productivity', x: (d) => d.sleepMinutes, y: (d) => d.productivity, xName: 'sleep', yName: 'task completion' },
    { id: 'corr-water-mood', title: 'Water ↔ mood', x: (d) => (d.waterMl > 0 ? d.waterMl : null), y: (d) => d.mood, xName: 'hydration', yName: 'mood' },
    { id: 'corr-deepwork-mood', title: 'Deep work ↔ mood', x: (d) => (d.logged ? d.deepWorkMin : null), y: (d) => d.mood, xName: 'deep work', yName: 'mood' },
    { id: 'corr-wasted-mood', title: 'Scrolling ↔ mood', x: (d) => (d.logged ? d.wastedMin : null), y: (d) => d.mood, xName: 'scrolling', yName: 'mood' },
  ];
  for (const spec of corrSpecs) {
    const pairs: Array<[number, number]> = [];
    for (const d of days) {
      const x = spec.x(d);
      const y = spec.y(d);
      if (x == null || y == null) continue;
      pairs.push([x, y]);
    }
    const r = pearson(pairs);
    if (r == null || Math.abs(r) < 0.25) continue;
    const strength = Math.abs(r) >= 0.6 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'mild';
    out.push({
      id: spec.id,
      kind: 'correlation',
      title: spec.title,
      detail: `${strength[0].toUpperCase()}${strength.slice(1)} ${r > 0 ? 'positive' : 'negative'} relationship between ${spec.xName} and ${spec.yName} (r = ${r.toFixed(2)}, n = ${pairs.length} days).`,
      n: pairs.length,
      confidence: pairs.length >= 14 ? 'solid' : 'early',
      effect: r,
    });
  }

  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
  const hurdlesByWeekday: number[] = Array(7).fill(0);
  for (const d of days) {
    if (d.productivity != null) byWeekday[d.weekday].push(d.productivity);
    hurdlesByWeekday[d.weekday] += d.hurdles;
  }
  const weekdayMeans = byWeekday.map((xs, i) => ({ i, n: xs.length, m: mean(xs) })).filter((w) => w.n >= 2);
  if (weekdayMeans.length >= 3) {
    const best = weekdayMeans.reduce((a, b) => (b.m > a.m ? b : a));
    const worst = weekdayMeans.reduce((a, b) => (b.m < a.m ? b : a));
    if (best.i !== worst.i && best.m - worst.m >= 15) {
      out.push({
        id: 'weekday-productivity',
        kind: 'weekday',
        title: 'Your week has a shape',
        detail: `${WEEKDAYS[best.i]}s are your strongest days (${Math.round(best.m)}% completion); ${WEEKDAYS[worst.i]}s are the weakest (${Math.round(worst.m)}%). Schedule deep work on ${WEEKDAYS[best.i]}s.`,
        n: weekdayMeans.reduce((a, w) => a + w.n, 0),
        confidence: 'early',
        effect: (best.m - worst.m) / 100,
      });
    }
  }
  const totalHurdles = hurdlesByWeekday.reduce((a, b) => a + b, 0);
  if (totalHurdles >= 4) {
    const hot = hurdlesByWeekday.indexOf(Math.max(...hurdlesByWeekday));
    if (hurdlesByWeekday[hot] / totalHurdles >= 0.35) {
      out.push({
        id: 'weekday-hurdles',
        kind: 'weekday',
        title: 'Hurdle hotspot',
        detail: `${Math.round((hurdlesByWeekday[hot] / totalHurdles) * 100)}% of your hurdles land on ${WEEKDAYS[hot]}s. Pre-split big tasks into micro-steps the evening before.`,
        n: totalHurdles,
        confidence: totalHurdles >= 8 ? 'solid' : 'early',
        effect: hurdlesByWeekday[hot] / totalHurdles,
      });
    }
  }

  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}
