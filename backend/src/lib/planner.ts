import type { Capacity } from './capacity';
import { daysBetween } from './dates';

// ---------------------------------------------------------------------------
// LifeLog v2.1 energy-aware day planner. Pure + deterministic: same inputs, same plan.
// Contract: notes/v2.1-planner-contract.md
// ---------------------------------------------------------------------------

export type PlanEnergy = 'deep' | 'admin' | 'quick' | 'recovery' | 'habit';
export type BlockStatus = 'planned' | 'active' | 'done' | 'skipped';
export type BlockKind = 'task' | 'batch' | 'recovery' | 'habit';
export type PlanLevel = 'recovery' | 'steady' | 'peak';

export interface PlanBlock {
  id: string;
  kind: BlockKind;
  title: string;
  energy: PlanEnergy;
  start: number;
  minutes: number;
  status: BlockStatus;
  reason: string;
  taskId?: number;
  taskIds?: number[];
  items?: Array<{ taskId: number; title: string }>;
  habitId?: number;
  tier?: 'bronze' | 'silver' | 'gold';
  startedAt?: number;
  completedAt?: number;
  loggedMinutes?: number;
  timeLogId?: number;
}

export interface PlanWindow {
  start: number;
  end: number;
  source: 'time_logs' | 'default';
  samples: number;
}

export interface PlanWrap {
  hurdle: string | null;
  tomorrowTop: string | null;
  completed: string[];
  tomorrowTaskId?: number;
  savedAt: number;
}

export interface DayPlan {
  date: string;
  capacity: number;
  capacityKnown: boolean;
  level: PlanLevel;
  why: string;
  window: PlanWindow;
  blocks: PlanBlock[];
  deferred: number;
  accepted: boolean;
  acceptedAt?: number;
  wrap?: PlanWrap;
  generatedAt: number;
  version: 1;
}

export interface PlannerTask {
  id: number;
  title: string;
  priority: string | null;
  energy_tag: string | null;
  status: string;
  date: string;
  parent_task_id: number | null;
  hurdled?: boolean;
}

export interface PlannerHabit {
  id: number;
  name: string;
  floor_label: string | null;
  target_label: string | null;
  keptToday: boolean;
}

export interface PlannerInput {
  date: string;
  capacity: Capacity;
  sleepMinutes: number | null;
  mood: number | null;
  waterMl: number | null;
  tasks: PlannerTask[];
  habits: PlannerHabit[];
  window: PlanWindow;
  nowHour?: number | null;
  /** Blocks from a previous plan that must survive a replan (done / active / skipped). */
  keep?: PlanBlock[];
  now?: number;
}

export const DEFAULT_WINDOW: PlanWindow = { start: 9, end: 12, source: 'default', samples: 0 };
export const WINDOW_MIN_SAMPLES = 7;
const WINDOW_HOURS = 3;
const DAY_END = 22;
const BUFFER_H = 10 / 60;
const UNKNOWN_CAPACITY = 70;

export interface TierRules {
  deepCount: number;
  deepMinutes: number;
  adminMaxTasks: number;
  adminMaxMinutes: number;
  recoveryMinutes: number;
  habitTier: 'bronze' | 'silver';
}

export function levelFor(capacity: number): PlanLevel {
  return capacity >= 85 ? 'peak' : capacity >= 65 ? 'steady' : 'recovery';
}

export function tierRules(capacity: number): TierRules {
  if (capacity >= 85) return { deepCount: 2, deepMinutes: 90, adminMaxTasks: 5, adminMaxMinutes: 45, recoveryMinutes: 20, habitTier: 'silver' };
  if (capacity >= 65) return { deepCount: 1, deepMinutes: capacity >= 75 ? 75 : 60, adminMaxTasks: 4, adminMaxMinutes: 30, recoveryMinutes: 20, habitTier: 'silver' };
  if (capacity >= 45) return { deepCount: 1, deepMinutes: 45, adminMaxTasks: 2, adminMaxMinutes: 20, recoveryMinutes: 20, habitTier: 'bronze' };
  return { deepCount: 0, deepMinutes: 0, adminMaxTasks: 2, adminMaxMinutes: 20, recoveryMinutes: 30, habitTier: 'bronze' };
}

const PRIORITY_POINTS: Record<string, number> = { urgent: 40, high: 30, medium: 20, low: 10 };

export function carriedDays(task: Pick<PlannerTask, 'date'>, date: string): number {
  return Math.max(0, daysBetween(task.date, date));
}

/** Priority plus fair aging: every carried day adds 4 points (max 20), so old work rises instead of rotting. */
export function taskScore(task: PlannerTask, date: string): number {
  const base = PRIORITY_POINTS[task.priority ?? 'medium'] ?? 20;
  const carry = Math.min(20, carriedDays(task, date) * 4);
  const ongoing = task.status === 'ongoing' ? 5 : 0;
  const hurdle = task.status === 'needs_attention' || task.hurdled ? -10 : 0;
  return base + carry + ongoing + hurdle;
}

export function orderTasks(tasks: PlannerTask[], date: string): PlannerTask[] {
  return [...tasks].sort((a, b) =>
    taskScore(b, date) - taskScore(a, date) || a.date.localeCompare(b.date) || a.id - b.id
  );
}

function taskReason(task: PlannerTask, date: string): string {
  const p = task.priority ?? 'medium';
  const parts = [`${p[0].toUpperCase()}${p.slice(1)} priority`];
  const c = carriedDays(task, date);
  if (c > 0) parts.push(`carried ${c} day${c === 1 ? '' : 's'}`);
  if (task.status === 'ongoing') parts.push('already in motion');
  if (task.status === 'needs_attention' || task.hurdled) parts.push('has a hurdle: start with the smallest step');
  return parts.join(' · ');
}

export const quarter = (h: number) => Math.round(h * 4) / 4;
const ceilQuarter = (h: number) => Math.ceil(h * 4 - 1e-9) / 4;

export function clockLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}m`;
}

const EXERCISE_RE = /walk|run|jog|yoga|stretch|gym|workout|swim|bike|cycl|move|exercise|outside/i;
const LEARNING_RE = /read|study|learn|course|book|page/i;
const MORNING_RE = /morning|wake|water|meditat|stretch|breath/i;

/** Which time_logs category a finished block lands in. */
export function timeCategoryFor(block: Pick<PlanBlock, 'energy' | 'title'>): string {
  if (block.energy === 'deep') return 'deep_work';
  if (block.energy === 'admin' || block.energy === 'quick') return 'admin';
  if (EXERCISE_RE.test(block.title)) return 'exercise';
  if (block.energy === 'habit' && LEARNING_RE.test(block.title)) return 'learning';
  return 'rested';
}

interface Interval { s: number; e: number }

/** First quarter-hour start >= anchor whose [start, end+buffer] avoids every busy interval and ends by 22:00. */
function findSlot(anchor: number, minutes: number, busy: Interval[], earliest: number): number | null {
  const len = minutes / 60;
  let s = ceilQuarter(Math.max(anchor, earliest));
  for (let guard = 0; guard < 96; guard++) {
    const e = s + len;
    if (e > DAY_END + 1e-9) return null;
    const clash = busy.find((b) => s < b.e + BUFFER_H - 1e-9 && e + BUFFER_H > b.s + 1e-9);
    if (!clash) return s;
    s = ceilQuarter(clash.e + BUFFER_H);
  }
  return null;
}

export function habitBlockMinutes(label: string | null, bronze: boolean): number {
  const match = label?.match(/(\d+)\s*(?:min(?:ute)?s?|m)\b/i);
  return match ? Math.min(60, Math.max(1, Number(match[1]))) : bronze ? 5 : 15;
}

export function buildPlan(input: PlannerInput): DayPlan {
  const { date, window } = input;
  const capacityKnown = input.capacity.score != null;
  const capacity = capacityKnown ? (input.capacity.score as number) : UNKNOWN_CAPACITY;
  const level = levelFor(capacity);
  const rules = tierRules(capacity);
  const earliest = input.nowHour != null && Number.isFinite(input.nowHour) ? Math.max(5, input.nowHour) : 5;

  const keep = (input.keep ?? []).map((b) => ({ ...b }));
  const usedTaskIds = new Set<number>();
  const usedHabitIds = new Set<number>();
  const usedIds = new Set<string>();
  for (const b of keep) {
    usedIds.add(b.id);
    if (b.taskId != null) usedTaskIds.add(b.taskId);
    (b.taskIds ?? []).forEach((id) => usedTaskIds.add(id));
    if (b.habitId != null) usedHabitIds.add(b.habitId);
  }
  const busy: Interval[] = keep.filter((b) => b.status !== 'skipped').map((b) => ({ s: b.start, e: b.start + b.minutes / 60 }));
  const uniqueId = (base: string) => {
    let id = base;
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  };

  // Parents with open sub-steps are represented by their steps.
  const openParents = new Set(input.tasks.filter((t) => t.parent_task_id != null).map((t) => t.parent_task_id as number));
  const eligible = orderTasks(
    input.tasks.filter((t) => t.status !== 'completed' && !openParents.has(t.id) && !usedTaskIds.has(t.id)),
    date
  );
  const energyOf = (t: PlannerTask) => (t.energy_tag ?? 'quick') as string;

  const placed: PlanBlock[] = [];
  const place = (block: Omit<PlanBlock, 'start'>, anchor: number): boolean => {
    const start = findSlot(anchor, block.minutes, busy, earliest);
    if (start == null) return false;
    busy.push({ s: start, e: start + block.minutes / 60 });
    placed.push({ ...block, start });
    return true;
  };

  // 1. Deep blocks at the start of the productive window.
  const deepTasks = eligible.filter((t) => energyOf(t) === 'deep').slice(0, rules.deepCount);
  let deepPlaced = 0;
  for (const t of deepTasks) {
    const ok = place({
      id: uniqueId(`t${t.id}`), kind: 'task', title: t.title, energy: 'deep', minutes: rules.deepMinutes,
      status: 'planned', reason: taskReason(t, date), taskId: t.id,
    }, window.start);
    if (ok) { usedTaskIds.add(t.id); deepPlaced++; }
  }
  const deepEnd = placed.filter((b) => b.energy === 'deep').reduce((m, b) => Math.max(m, b.start + b.minutes / 60), window.start);

  // 2. One admin batch: admin + quick tasks, fewer on low capacity.
  const adminTasks: PlannerTask[] = [];
  let adminMinutes = 0;
  for (const t of eligible) {
    if (usedTaskIds.has(t.id)) continue;
    const e = energyOf(t);
    if (e !== 'admin' && e !== 'quick') continue;
    const cost = e === 'quick' ? 10 : 15;
    if (adminTasks.length >= rules.adminMaxTasks) break;
    if (adminMinutes + cost > rules.adminMaxMinutes) continue; // a smaller task may still fit
    adminTasks.push(t);
    adminMinutes += cost;
  }
  let adminAfterLunch = false;
  if (adminTasks.length > 0) {
    const morningWindow = window.start < 12;
    adminAfterLunch = !(morningWindow && level !== 'recovery' && deepEnd + BUFFER_H <= 12 - adminMinutes / 60);
    const anchor = morningWindow ? (adminAfterLunch ? 13.5 : deepEnd) : 10;
    const minutes = Math.max(15, adminMinutes);
    const single = adminTasks.length === 1 ? adminTasks[0] : null;
    const block: Omit<PlanBlock, 'start'> = single
      ? { id: uniqueId(`t${single.id}`), kind: 'task', title: single.title, energy: energyOf(single) as PlanEnergy, minutes,
          status: 'planned', reason: taskReason(single, date), taskId: single.id }
      : { id: uniqueId('admin'), kind: 'batch', title: `${adminTasks.length} quick tasks`, energy: 'admin', minutes,
          status: 'planned', reason: `Batched so small things stop leaking into focus time · top: ${adminTasks[0].title}`,
          taskIds: adminTasks.map((t) => t.id), items: adminTasks.map((t) => ({ taskId: t.id, title: t.title })) };
    if (place(block, anchor)) adminTasks.forEach((t) => usedTaskIds.add(t.id));
  }

  // 3. Recovery: the top recovery-tagged task, else a walk. Never skipped on any capacity.
  const recoveryTask = eligible.find((t) => !usedTaskIds.has(t.id) && energyOf(t) === 'recovery');
  const recoveryAnchor = window.start <= 15 && window.end > 15 ? window.end : 15;
  if (!keep.some((b) => b.kind === 'recovery' || (b.energy === 'recovery' && b.status !== 'skipped'))) {
    const block: Omit<PlanBlock, 'start'> = recoveryTask
      ? { id: uniqueId(`t${recoveryTask.id}`), kind: 'recovery', title: recoveryTask.title, energy: 'recovery',
          minutes: rules.recoveryMinutes, status: 'planned', reason: `Recovery keeps the afternoon usable · ${taskReason(recoveryTask, date)}`,
          taskId: recoveryTask.id }
      : { id: uniqueId('recovery'), kind: 'recovery', title: `${rules.recoveryMinutes}-min walk`, energy: 'recovery',
          minutes: rules.recoveryMinutes, status: 'planned',
          reason: level === 'recovery' ? 'Low tank: movement and daylight refill it faster than pushing through' : 'A short reset between work and the rest of your day' };
    if (place(block, recoveryAnchor) && recoveryTask) usedTaskIds.add(recoveryTask.id);
  }

  // 4. Habits not yet kept today, at floor tier on low capacity.
  let habitsPlaced = 0;
  for (const h of input.habits) {
    if (h.keptToday || usedHabitIds.has(h.id)) continue;
    const bronze = rules.habitTier === 'bronze';
    const label = bronze ? h.floor_label : h.target_label;
    const minutes = habitBlockMinutes(label, bronze);
    const anchor = MORNING_RE.test(h.name) ? Math.max(7, window.start - 1) : 17.5;
    const ok = place({
      id: uniqueId(`h${h.id}`), kind: 'habit', title: label ? `${h.name} · ${label}` : h.name, energy: 'habit',
      minutes, status: 'planned', habitId: h.id, tier: rules.habitTier,
      reason: bronze ? 'Floor version: keeps the streak alive on a low-capacity day' : 'Target version: you have the capacity for it',
    }, anchor);
    if (ok) habitsPlaced++;
  }

  const blocks = [...keep, ...placed].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const skippedTaskIds = new Set<number>();
  keep.filter((b) => b.status === 'skipped').forEach((b) => {
    if (b.taskId != null) skippedTaskIds.add(b.taskId);
    (b.taskIds ?? []).forEach((id) => skippedTaskIds.add(id));
  });
  const deferred = input.tasks.filter(
    (t) => t.status !== 'completed' && !openParents.has(t.id) && (!usedTaskIds.has(t.id) || skippedTaskIds.has(t.id))
  ).length;

  const why = explain({
    capacity, capacityKnown, level, rules, window, deepPlaced, adminAfterLunch,
    adminCount: adminTasks.length, deferred, sleepMinutes: input.sleepMinutes, mood: input.mood, waterMl: input.waterMl,
    deepStart: placed.find((b) => b.energy === 'deep')?.start ?? null, habitsPlaced, hadDeepTasks: eligible.some((t) => energyOf(t) === 'deep'),
  });

  return {
    date, capacity, capacityKnown, level, why, window, blocks, deferred,
    accepted: false, generatedAt: input.now ?? Date.now(), version: 1,
  };
}

interface ExplainInput {
  capacity: number; capacityKnown: boolean; level: PlanLevel; rules: TierRules; window: PlanWindow;
  deepPlaced: number; deepStart: number | null; adminAfterLunch: boolean; adminCount: number; deferred: number;
  sleepMinutes: number | null; mood: number | null; waterMl: number | null; habitsPlaced: number; hadDeepTasks: boolean;
}

/** One line a person can read in three seconds: inputs → capacity → shape of the day. */
export function explain(x: ExplainInput): string {
  const signals: string[] = [];
  if (x.sleepMinutes != null && x.sleepMinutes > 0) signals.push(`${durationLabel(x.sleepMinutes)} sleep`);
  if (x.mood != null) signals.push(`mood ${x.mood}/5`);
  if (x.waterMl != null && x.waterMl > 0) signals.push(`${(x.waterMl / 1000).toFixed(1)}L water`);
  const head = x.capacityKnown
    ? `${signals.join(' · ')} → ${x.capacity}% capacity`
    : 'Nothing logged yet → assuming a steady 70% day';

  const shape: string[] = [];
  const count = x.deepPlaced === 2 ? 'two' : 'one';
  if (x.deepPlaced > 0) {
    const where = x.window.source === 'time_logs'
      ? `in your usual focus hours ${clockLabel(x.window.start)}–${clockLabel(x.window.end)}`
      : `at ${clockLabel(x.deepStart ?? x.window.start)}`;
    shape.push(`${count} ${x.rules.deepMinutes}-min deep block${x.deepPlaced === 2 ? 's' : ''} ${where}`);
  } else if (x.rules.deepCount === 0) {
    shape.push('no deep work today, small wins only');
  } else if (!x.hadDeepTasks) {
    shape.push('no deep task open, so no deep block');
  }
  if (x.adminCount > 0) shape.push(x.adminAfterLunch ? 'admin after lunch' : 'admin right after');
  if (x.level === 'recovery') shape.push('a real recovery break');
  if (x.habitsPlaced > 0 && x.rules.habitTier === 'bronze') shape.push('floor habits');

  const tail = x.deferred > 0 ? ` ${x.deferred} task${x.deferred === 1 ? ' waits' : 's wait'} for tomorrow, no guilt.` : '';
  return `${head} → ${shape.join(', ') || 'a light day'}.${tail}`;
}

// ---------------------------------------------------------------------------
// Productive window from time_logs
// ---------------------------------------------------------------------------

export interface WindowLog {
  date: string;
  category: string;
  minutes: number;
  created_at: string;
}

function localParts(utcIso: string, tz: string | undefined): { date: string; minutes: number } | null {
  const t = Date.parse(utcIso.includes('T') ? utcIso : utcIso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(t))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Best 3-hour focus span. Only deep_work / learning logs recorded on the same local day they
 * describe count, because a backfilled log says nothing about the hour the work happened.
 * A log's minutes are spread backwards from the moment it was recorded.
 */
export function deriveWindow(logs: WindowLog[], tz?: string): PlanWindow {
  const bins = new Array<number>(24).fill(0);
  const days = new Set<string>();
  for (const log of logs) {
    if (log.category !== 'deep_work' && log.category !== 'learning') continue;
    const minutes = Number(log.minutes) || 0;
    if (minutes <= 0) continue;
    const local = localParts(String(log.created_at), tz);
    if (!local || local.date !== log.date) continue;
    days.add(log.date);
    const end = local.minutes;
    const start = Math.max(0, end - minutes);
    for (let h = Math.floor(start / 60); h <= Math.floor((end - 1) / 60) && h < 24; h++) {
      const overlap = Math.min(end, (h + 1) * 60) - Math.max(start, h * 60);
      if (overlap > 0) bins[h] += overlap;
    }
  }
  if (days.size < WINDOW_MIN_SAMPLES) return { ...DEFAULT_WINDOW, samples: days.size };
  let best = -1;
  let bestStart = DEFAULT_WINDOW.start;
  for (let h = 6; h + WINDOW_HOURS <= DAY_END; h++) {
    const sum = bins[h] + bins[h + 1] + bins[h + 2];
    if (sum > best) { best = sum; bestStart = h; }
  }
  if (best <= 0) return { ...DEFAULT_WINDOW, samples: days.size };
  return { start: bestStart, end: bestStart + WINDOW_HOURS, source: 'time_logs', samples: days.size };
}
