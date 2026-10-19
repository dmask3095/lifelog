// Pure, framework-free capture logic shared by QuickAddTask, AgendaView, OmniBar and HabitPanel.
// No React, no axios: everything here runs under `node --test` (see frontend/tests/capture.test.ts).
import type { EnergyTag, HabitTier, Priority, Task } from '../types';

/** How long a just-added row stays highlighted. */
export const HIGHLIGHT_MS = 2000;
/** A second identical submit inside this window is treated as a lagged double click. */
export const DUPLICATE_WINDOW_MS = 1500;
/** Minimum hit target for every capture control (px). */
export const MIN_HIT = 40;

export type PendingState = 'saving' | 'saved' | 'error';

export interface NewTaskInput {
  title: string;
  date: string;
  priority?: Priority;
  energy_tag?: EnergyTag;
}

export interface PendingAdd {
  tempId: string;
  title: string;
  date: string;
  priority: Priority;
  energy_tag: EnergyTag;
  state: PendingState;
  startedAt: number;
  savedAt?: number;
  error?: string;
  /** Server row once saved. */
  task?: Task;
}

export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const ENERGIES: EnergyTag[] = ['deep', 'admin', 'quick', 'recovery'];

/**
 * Tiny inline syntax for the quick-add box, so power users never need the pickers:
 *   "Ship launch post !"   -> high      "Pay rent !!" -> urgent
 *   "Draft spec #deep"     -> energy deep (#deep #admin #quick #recovery)
 *   "Tidy desk #low"       -> priority low (#low #medium #high #urgent)
 * Anything not recognised stays in the title untouched.
 */
export function parseQuickTitle(raw: string): { title: string; priority?: Priority; energy_tag?: EnergyTag } {
  let text = normalizeTitle(raw);
  let priority: Priority | undefined;
  let energy_tag: EnergyTag | undefined;

  text = text.replace(/(^|\s)#([a-z]+)\b/gi, (match, lead: string, word: string) => {
    const w = word.toLowerCase();
    if ((ENERGIES as string[]).includes(w)) { energy_tag = w as EnergyTag; return lead; }
    if ((PRIORITIES as string[]).includes(w)) { priority = w as Priority; return lead; }
    return match;
  });

  const bang = text.match(/\s*(!{1,3})$/);
  if (bang && text.length > bang[0].length) {
    priority = bang[1].length >= 2 ? 'urgent' : 'high';
    text = text.slice(0, text.length - bang[0].length);
  }

  return { title: normalizeTitle(text), priority, energy_tag };
}

let seq = 0;
export function makeTempId(now: number = Date.now()): string {
  seq += 1;
  return `tmp-${now.toString(36)}-${seq}`;
}

export function makePending(input: NewTaskInput, tempId: string, now: number): PendingAdd {
  return {
    tempId,
    title: normalizeTitle(input.title),
    date: input.date,
    priority: input.priority ?? 'medium',
    energy_tag: input.energy_tag ?? 'quick',
    state: 'saving',
    startedAt: now,
  };
}

export function markSaved(list: PendingAdd[], tempId: string, task: Task, now: number): PendingAdd[] {
  return list.map((p) => (p.tempId === tempId ? { ...p, state: 'saved' as const, task, savedAt: now, error: undefined } : p));
}

export function markError(list: PendingAdd[], tempId: string, error: string): PendingAdd[] {
  return list.map((p) => (p.tempId === tempId ? { ...p, state: 'error' as const, error } : p));
}

export function markSaving(list: PendingAdd[], tempId: string, now: number): PendingAdd[] {
  return list.map((p) => (p.tempId === tempId ? { ...p, state: 'saving' as const, error: undefined, startedAt: now } : p));
}

/** Saved pending entries whose server row is now present in the fetched list can be dropped. */
export function settledTempIds(pending: PendingAdd[], serverTasks: Task[]): string[] {
  const ids = new Set(serverTasks.map((t) => t.id));
  return pending.filter((p) => p.state === 'saved' && p.task && ids.has(p.task.id)).map((p) => p.tempId);
}

export function isFresh(p: PendingAdd, now: number, ms: number = HIGHLIGHT_MS): boolean {
  if (p.state !== 'saved') return true; // saving and error rows always stand out
  return p.savedAt != null && now - p.savedAt < ms;
}

export type DisplayRow =
  | { kind: 'pending'; key: string; pending: PendingAdd }
  | { kind: 'task'; key: string; task: Task; justAdded: true };

/**
 * Splits what the task list shows into a pinned "just added" strip and the rest.
 * - saving / failed adds for this date: optimistic rows, newest first
 * - saved adds: the server's fresher copy if the list already has it, else the create response
 * - earlier just-added ids (pinnedIds, newest first) stay pinned while they still exist on the server
 * Pinned rows are never subject to grouping or Minimum Viable Day filtering.
 */
export function mergeForDisplay(serverTasks: Task[], pending: PendingAdd[], pinnedIds: number[], date: string): { pinned: DisplayRow[]; rest: Task[] } {
  const byId = new Map(serverTasks.map((t) => [t.id, t] as const));
  const pinned: DisplayRow[] = [];
  const used = new Set<number>();

  const sorted = pending.filter((p) => p.date === date).sort((a, b) => b.startedAt - a.startedAt);
  for (const p of sorted) {
    if (p.state === 'saved' && p.task) {
      if (used.has(p.task.id)) continue;
      used.add(p.task.id);
      pinned.push({ kind: 'task', key: `t${p.task.id}`, task: byId.get(p.task.id) ?? p.task, justAdded: true });
    } else {
      pinned.push({ kind: 'pending', key: p.tempId, pending: p });
    }
  }
  for (const id of pinnedIds) {
    const t = byId.get(id);
    if (!t || used.has(id)) continue;
    used.add(id);
    pinned.push({ kind: 'task', key: `t${id}`, task: t, justAdded: true });
  }
  return { pinned, rest: serverTasks.filter((t) => !used.has(t.id)) };
}

/**
 * Minimum Viable Day: show completed tasks and the top `keep` open tasks; park the rest.
 * Tasks in `protectedIds` are always shown and do not consume a slot.
 */
export function applyMvd(tasks: Task[], on: boolean, protectedIds: Set<number> = new Set(), keep = 2): { shown: Task[]; hidden: Task[] } {
  if (!on) return { shown: tasks, hidden: [] };
  const shown: Task[] = [];
  const hidden: Task[] = [];
  let openKept = 0;
  for (const t of tasks) {
    if (t.status === 'completed' || protectedIds.has(t.id)) { shown.push(t); continue; }
    if (openKept < keep) { shown.push(t); openKept += 1; } else hidden.push(t);
  }
  return { shown, hidden };
}

export type GuardResult = 'ok' | 'in-flight' | 'duplicate';

/**
 * Synchronous double-submit guard. React state updates land a frame late, and the user's
 * remote mirror can deliver Enter and a synthesized click for the same intent; a ref-held
 * guard rejects the second one before any request is made.
 */
export function createSubmitGuard(windowMs: number = DUPLICATE_WINDOW_MS) {
  const inFlight = new Set<string>();
  let last: { key: string; at: number } | null = null;
  return {
    begin(key: string, now: number = Date.now()): GuardResult {
      if (inFlight.has(key)) return 'in-flight';
      if (last && last.key === key && now - last.at < windowMs) return 'duplicate';
      inFlight.add(key);
      last = { key, at: now };
      return 'ok';
    },
    end(key: string) { inFlight.delete(key); },
    /** Forget the duplicate window (e.g. explicit Retry after a failure). */
    reset(key?: string) {
      if (key) inFlight.delete(key);
      if (!key || last?.key === key) last = null;
    },
    busy(key?: string): boolean { return key ? inFlight.has(key) : inFlight.size > 0; },
    /**
     * True right after any accepted submit. A lagged second click lands after the input was
     * cleared; callers treat that empty submit as a no-op instead of showing the empty hint.
     */
    recentlyStarted(now: number = Date.now()): boolean { return !!last && now - last.at < windowMs; },
  };
}
export type SubmitGuard = ReturnType<typeof createSubmitGuard>;

export function taskKey(date: string, title: string): string {
  return `${date}|${normalizeTitle(title).toLowerCase()}`;
}

/** Human, specific error text for an axios-style failure. */
export function describeError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as { response?: { status?: number; data?: { error?: unknown } }; code?: string; message?: string };
  const serverMsg = e.response?.data?.error;
  if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg.trim();
  const status = e.response?.status;
  if (status === 401) return 'Your session expired. Sign in again, then retry.';
  if (status && status >= 500) return `${fallback}: the server had a problem (${status}). Try again.`;
  if (status) return `${fallback} (error ${status}).`;
  if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED' || /network|timeout/i.test(e.message ?? '')) {
    return "Couldn't reach the server. Check your connection and retry.";
  }
  return `${fallback}. Try again.`;
}

// ---- tasks: optimistic local edits ------------------------------------------
export function patchTask(tasks: Task[], id: number, patch: Partial<Task>): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

export function removeTask(tasks: Task[], id: number): Task[] {
  return tasks.filter((t) => t.id !== id && t.parent_task_id !== id);
}

// ---- habits: optimistic tier toggles ------------------------------------------
export interface HabitLike {
  id: number;
  completed: boolean;
  tier: HabitTier | null;
  history14: Array<{ date: string; tier: HabitTier | null }>;
}

/** Tapping the active tier turns the habit off; any other tier sets it. */
export function nextHabitState(current: { completed: boolean; tier: HabitTier | null }, tier: HabitTier): { completed: boolean; tier: HabitTier | null } {
  if (current.completed && current.tier === tier) return { completed: false, tier: null };
  return { completed: true, tier };
}

export function applyHabitState<H extends HabitLike>(habits: H[], id: number, state: { completed: boolean; tier: HabitTier | null }, date: string): H[] {
  return habits.map((h) => {
    if (h.id !== id) return h;
    const tier = state.completed ? state.tier : null;
    return {
      ...h,
      completed: state.completed,
      tier,
      history14: h.history14.map((d) => (d.date === date ? { ...d, tier } : d)),
    };
  });
}
