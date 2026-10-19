import { useCallback, useEffect, useRef, useState } from 'react';
import { createTask } from '../api';
import { useRefresh } from '../context/RefreshContext';
import type { Task } from '../types';
import {
  createSubmitGuard, describeError, makePending, makeTempId, markError, markSaved, markSaving,
  normalizeTitle, taskKey, type NewTaskInput, type PendingAdd,
} from './capture';

/** 'busy' = swallowed as a duplicate (same task in flight, or a lagged click right after a submit). */
export type SubmitOutcome = 'empty' | 'busy' | 'started';

interface Options {
  /** Called with the server row right after a successful create. */
  onCreated?: (task: Task) => void;
  /** Called after a successful create (after onCreated). */
  onAdded?: () => void;
  /** Bump the shared RefreshContext after a successful create (default true). */
  bumpOnSuccess?: boolean;
}

/**
 * Optimistic task creation with a synchronous double-submit guard, inline error state and retry.
 * Pending entries are kept per date; callers filter with `date` when rendering.
 */
export function useQuickAdd({ onCreated, onAdded, bumpOnSuccess = true }: Options = {}) {
  const { bump } = useRefresh();
  const [pending, setPending] = useState<PendingAdd[]>([]);
  const guardRef = useRef(createSubmitGuard());
  const pendingRef = useRef<PendingAdd[]>([]);
  const cbRef = useRef({ onCreated, onAdded, bump, bumpOnSuccess });
  useEffect(() => { cbRef.current = { onCreated, onAdded, bump, bumpOnSuccess }; });
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const update = useCallback((fn: (list: PendingAdd[]) => PendingAdd[]) => {
    setPending((list) => {
      const next = fn(list);
      pendingRef.current = next;
      return next;
    });
  }, []);

  const run = useCallback(async (p: PendingAdd) => {
    const key = taskKey(p.date, p.title);
    try {
      const res = await createTask({ title: p.title, priority: p.priority, date: p.date, energy_tag: p.energy_tag });
      update((list) => markSaved(list, p.tempId, res.data, Date.now()));
      const cb = cbRef.current;
      cb.onCreated?.(res.data);
      cb.onAdded?.();
      if (cb.bumpOnSuccess) cb.bump();
    } catch (err) {
      update((list) => markError(list, p.tempId, describeError(err, 'Couldn’t save this task')));
      guardRef.current.reset(key); // an explicit retry or resubmit must not be eaten as a duplicate
    } finally {
      guardRef.current.end(key);
    }
  }, [update]);

  const submit = useCallback((input: NewTaskInput): SubmitOutcome => {
    const title = normalizeTitle(input.title);
    if (!title) return guardRef.current.recentlyStarted() ? 'busy' : 'empty';
    const key = taskKey(input.date, title);
    if (guardRef.current.begin(key) !== 'ok') return 'busy';
    const p = makePending({ ...input, title }, makeTempId(), Date.now());
    update((list) => [p, ...list].slice(0, 30));
    void run(p);
    return 'started';
  }, [run, update]);

  const retry = useCallback((tempId: string) => {
    const p = pendingRef.current.find((x) => x.tempId === tempId);
    if (!p || p.state !== 'error') return;
    const key = taskKey(p.date, p.title);
    if (guardRef.current.begin(key) !== 'ok') return;
    const now = Date.now();
    update((list) => markSaving(list, tempId, now));
    void run({ ...p, state: 'saving', error: undefined, startedAt: now });
  }, [run, update]);

  const dismiss = useCallback((tempId: string) => {
    update((list) => list.filter((x) => x.tempId !== tempId));
  }, [update]);

  const settle = useCallback((tempIds: string[]) => {
    if (tempIds.length === 0) return;
    const drop = new Set(tempIds);
    update((list) => list.filter((x) => !drop.has(x.tempId)));
  }, [update]);

  return { pending, submit, retry, dismiss, settle };
}

/** Re-renders while any timestamp in `until` is still in the future (for 2s highlights). */
export function useExpiring(until: number[]): number {
  const [now, setNow] = useState(() => Date.now());
  const latest = until.length ? Math.max(...until) : 0;
  useEffect(() => {
    const wait = latest - Date.now();
    if (wait <= 0) return;
    const handle = setTimeout(() => setNow(Date.now()), wait + 30);
    return () => clearTimeout(handle);
  }, [latest]);
  return now;
}
