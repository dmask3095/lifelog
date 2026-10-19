// Day-plan client contract + pure helpers for the Today screen.
// Kept dependency-free (type-only imports) so node --test can run the helpers directly.
import type { AxiosInstance } from 'axios';
import type { SummaryData } from '../../types';

export type BlockStatus = 'planned' | 'active' | 'done' | 'skipped';
export type BlockEnergy = 'deep' | 'admin' | 'quick' | 'recovery' | 'habit';

// Mirrors notes/v2.1-planner-contract.md (planner agent owns the backend).
export interface PlanBlock {
  id: string;
  kind?: 'task' | 'batch' | 'recovery' | 'habit';
  title: string;
  energy: BlockEnergy;
  /** Local start time in decimal hours, quarter-hour steps: 13.5 = 13:30 */
  start: number;
  minutes: number;
  status: BlockStatus;
  reason?: string;
  taskId?: number;
  taskIds?: number[];
  items?: Array<{ taskId: number; title: string }>;
  habitId?: number;
  tier?: 'bronze' | 'silver' | 'gold';
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  loggedMinutes?: number;
  timeLogId?: number;
}

export interface PlanWrap {
  hurdle: string | null;
  tomorrowTop: string | null;
  completed: string[];
  tomorrowTaskId?: number;
  hurdleTaskId?: number;
  hurdleId?: number;
  savedAt?: number;
}

export interface WrapPatch {
  hurdleTaskId?: number;
  tomorrowTaskId?: number;
  hurdle?: string | null;
  tomorrowTop?: string | null;
  completed?: string[];
  createTomorrowTask?: boolean;
}

export interface DayPlan {
  date: string;
  capacity: number;
  capacityKnown?: boolean;
  level?: 'recovery' | 'steady' | 'peak';
  why: string;
  window: { start: number; end: number; source: 'time_logs' | 'default' | string; samples?: number };
  blocks: PlanBlock[];
  deferred: number;
  accepted: boolean;
  acceptedAt?: number;
  wrap?: PlanWrap | null;
  generatedAt?: number;
}

export type BlockAction = 'start' | 'done' | 'skip' | 'move';

// ---- API ----------------------------------------------------------------------
// Responses are normalised: the planner may return the plan directly or as { plan }.
export function pickPlan(payload: unknown): DayPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = (payload as { plan?: unknown }).plan ?? payload;
  if (p && typeof p === 'object' && Array.isArray((p as DayPlan).blocks)) return p as DayPlan;
  return null;
}

/** nowHour/tz are only sent for today, per the contract. */
export function clientClock(isToday: boolean): { nowHour?: number; tz?: string } {
  if (!isToday) return {};
  const d = new Date();
  let tz: string | undefined;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = undefined; }
  return { nowHour: Math.round((d.getHours() + d.getMinutes() / 60) * 100) / 100, tz };
}

export const planApi = (api: AxiosInstance) => ({
  get: (date: string, isToday: boolean) => api.get(`/day-plans/${date}`, { params: clientClock(isToday) }),
  replan: (date: string, isToday: boolean) => api.post(`/day-plans/${date}/replan`, clientClock(isToday)),
  patch: (date: string, body: { accepted?: boolean; wrap?: WrapPatch }) => api.patch(`/day-plans/${date}`, body),
  action: (date: string, blockId: string, action: BlockAction, startHour?: number) =>
    api.post(`/day-plans/${date}/blocks/${encodeURIComponent(blockId)}/action`, startHour == null ? { action } : { action, startHour }),
});

export function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string; message?: string }; status?: number }; message?: string };
  const server = e?.response?.data?.error || e?.response?.data?.message;
  if (server) return server;
  if (e?.response?.status) return `${fallback} (HTTP ${e.response.status})`;
  if (e?.message === 'Network Error') return `${fallback}: can’t reach the server.`;
  return fallback;
}

// ---- formatting ---------------------------------------------------------------
export function formatHour(h: number): string {
  if (!Number.isFinite(h)) return '–';
  const total = Math.round(h * 60);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${Math.floor(wrapped / 60)}:${String(wrapped % 60).padStart(2, '0')}`;
}

export function formatSleep(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function toMs(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; // seconds or ms
  const asNum = Number(value);
  if (Number.isFinite(asNum) && /^\d+$/.test(value)) return toMs(asNum);
  // SQLite CURRENT_TIMESTAMP is UTC without a zone ("2026-10-19 14:00:00").
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Seconds elapsed on a running block, derived from the persisted startedAt (survives reloads). */
export function elapsedSeconds(block: Pick<PlanBlock, 'startedAt'>, now: number): number {
  const t = toMs(block.startedAt ?? null);
  return t == null ? 0 : Math.max(0, (now - t) / 1000);
}

export const isActive = (b: PlanBlock) => b.status === 'active';
export const isClosed = (b: PlanBlock) => b.status === 'done' || b.status === 'skipped';

export function deferredCount(plan: DayPlan | null): number {
  const d = plan?.deferred as unknown;
  if (typeof d === 'number') return d;
  return Array.isArray(d) ? d.length : 0;
}

/** Times the user can move a block to: the next few round hours after now, inside the day. */
export function moveOptions(nowHour: number, block: Pick<PlanBlock, 'start' | 'minutes'>, dayEnd = 22): number[] {
  const out: number[] = [];
  const first = Math.max(Math.ceil(nowHour + 0.25), Math.floor(block.start) + 1);
  for (let h = first; h + block.minutes / 60 <= dayEnd + 0.01 && out.length < 4; h += h < 13 ? 1 : 2) out.push(h);
  return out;
}

// ---- day state ----------------------------------------------------------------
export interface PlanStats { total: number; done: number; skipped: number; open: number; plannedMin: number; doneMin: number }

export function planStats(plan: DayPlan | null): PlanStats {
  const blocks = plan?.blocks ?? [];
  const done = blocks.filter((b) => b.status === 'done');
  return {
    total: blocks.length,
    done: done.length,
    skipped: blocks.filter((b) => b.status === 'skipped').length,
    open: blocks.filter((b) => !isClosed(b)).length,
    plannedMin: blocks.reduce((a, b) => a + (b.minutes || 0), 0),
    doneMin: done.reduce((a, b) => a + (b.loggedMinutes ?? b.minutes ?? 0), 0),
  };
}

export interface ScorePart { label: string; value: number; detail: string }
export interface DayScore { score: number | null; parts: ScorePart[] }

/** Day score = plain mean of the parts that actually have data. Nothing invented. */
export function dayScore(plan: DayPlan | null, data: SummaryData | null): DayScore {
  const parts: ScorePart[] = [];
  const s = planStats(plan);
  if (s.total > 0) parts.push({ label: 'Plan', value: Math.round((s.done / s.total) * 100), detail: `${s.done}/${s.total} blocks` });
  if (data && data.tasks.total > 0) parts.push({ label: 'Tasks', value: data.tasks.productivityScore, detail: `${data.tasks.completed}/${data.tasks.total} done` });
  if (data && data.habits.total > 0) parts.push({ label: 'Habits', value: data.habits.pct, detail: `${data.habits.completed}/${data.habits.total} kept` });
  if (parts.length === 0) return { score: null, parts };
  return { score: Math.round(parts.reduce((a, p) => a + p.value, 0) / parts.length), parts };
}

/** One line of encouragement grounded in the day's numbers. No fake praise. */
export function encouragement(plan: DayPlan | null, data: SummaryData | null, tomorrowTop?: string | null): string {
  const s = planStats(plan);
  const cap = data?.capacity.score ?? (plan?.capacityKnown ? plan.capacity : null);
  const low = cap != null && cap < 65;
  const next = tomorrowTop?.trim() ? ` Tomorrow opens with “${tomorrowTop.trim()}”.` : '';
  if (s.total === 0 && (!data || data.tasks.total === 0)) {
    return `No plan and no tasks today, so there is nothing to grade. Add one task tonight and tomorrow gets a real plan.${next}`;
  }
  if (s.total > 0 && s.done === s.total) {
    return `You finished all ${s.total} planned blocks${low ? ` on a ${cap}% capacity day` : ''}. The plan fit your energy; keep it this size.${next}`;
  }
  if (s.done === 0 && s.total > 0) {
    return `None of the ${s.total} blocks landed today${low ? `, on a ${cap}% capacity day` : ''}. That is data, not a verdict: tomorrow’s plan will start smaller.${next}`;
  }
  if (low && s.done > 0) {
    return `Capacity was ${cap}% and you still closed ${s.done} of ${s.total} blocks. That is the Minimum Viable Day doing its job.${next}`;
  }
  if (s.total > 0) {
    const pct = Math.round((s.done / s.total) * 100);
    return `${s.done} of ${s.total} blocks done (${pct}%)${s.doneMin ? `, about ${s.doneMin} focused minutes` : ''}. ${pct >= 60 ? 'A solid day; the carry-overs move to tomorrow without penalty.' : 'The rest carries over without penalty; tomorrow’s plan adjusts.'}${next}`;
  }
  const t = data!.tasks;
  return `${t.completed} of ${t.total} tasks done today.${t.completed > 0 ? ' Real progress, logged.' : ' Pick one small one to open tomorrow with.'}${next}`;
}

// ---- first run -----------------------------------------------------------------
export function isFreshAccount(data: SummaryData | null): boolean {
  if (!data) return false;
  return data.habits.total === 0 && data.tasks.total === 0 && data.loggedDays30 === 0;
}

export interface OnboardingProgress { sleep: boolean; tasks: number; habits: number; complete: boolean }
export function onboardingProgress(data: SummaryData | null, extraTasks = 0): OnboardingProgress {
  const sleep = !!data && data.body.totalSleepMinutes > 0;
  const tasks = Math.max(data?.tasks.total ?? 0, extraTasks);
  const habits = data?.habits.total ?? 0;
  return { sleep, tasks, habits, complete: sleep && tasks >= 3 && habits >= 2 };
}

/** "6h10 sleep" style chip text for the pattern line, only from real values. */
export function lastNightText(data: SummaryData | null): string | null {
  if (!data || !(data.body.totalSleepMinutes > 0)) return null;
  return `Last night: ${formatSleep(data.body.totalSleepMinutes)}.`;
}

export function sleepMinutesBetween(bed: string, wake: string): number {
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  const diff = wh * 60 + wm - (bh * 60 + bm);
  return diff <= 0 ? diff + 1440 : diff;
}
