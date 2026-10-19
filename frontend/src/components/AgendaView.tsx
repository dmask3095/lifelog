import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, CalendarClock, Check, ChevronDown, ChevronRight, CircleAlert, Clock, LoaderCircle, Play, Plus, RotateCcw, RotateCw, TriangleAlert, X } from 'lucide-react';
import { createHurdle, deleteTask, getSomedayTasks, getTaskHurdles, getTasks, resolveHurdle, splitTask, updateTask } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { daysBetween, formatShort } from '../lib/dates';
import { getMvd, MVD_EVENT } from '../lib/mvd';
import {
  applyMvd, createSubmitGuard, describeError, HIGHLIGHT_MS, mergeForDisplay, parseQuickTitle,
  patchTask, removeTask, settledTempIds, type PendingAdd,
} from '../lib/capture';
import { useExpiring, useQuickAdd } from '../lib/useQuickAdd';
import { ENERGY_META, PRIORITY_META, type EnergyTag, type Hurdle, type Priority, type SummaryData, type Task } from '../types';

interface Props {
  date: string;
  today: string;
  summary: SummaryData | null;
  onChanged: () => void;
}

const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low'];
const STATUS_LABELS: Record<Task['status'], string> = {
  pending: 'Pending', ongoing: 'In progress', completed: 'Done', needs_attention: 'Blocked',
};
const HURDLE_CHIPS = ['Waiting on someone', 'Too vague', 'Too big', 'Don’t know the first step', 'Low energy', 'Missing info'];
const TRIAGE_AFTER_DAYS = 2;
const HIT = { minHeight: 40, minWidth: 40 } as const;
const FRESH_STYLE = { boxShadow: 'inset 0 0 0 2px var(--accent, #59c3ff)' } as const;
const EMPTY_HINT = 'Type a task first, then press Enter or Add.';

function microStepTemplates(title: string): string[] {
  return [
    `Open everything needed for “${title}” (10 min)`,
    `Write the ugly first version of “${title}” (10 min)`,
    `Define what “done” looks like for “${title}” and finish one piece`,
  ];
}

function TaskRow({ task, children, date, today, hurdleCount, isSub, openDrawer, justAdded, fresh, onAction, onEdit, onDelete }: {
  task: Task; children?: React.ReactNode; date: string; today: string; hurdleCount: number; isSub: boolean;
  openDrawer: boolean; justAdded?: boolean; fresh?: boolean;
  onAction: (status: Task['status']) => void; onEdit: () => void; onDelete: () => void;
}) {
  const overdueDays = task.status !== 'completed' && task.date < date ? daysBetween(task.date, date) : 0;
  const pm = PRIORITY_META[task.priority];
  const cls = ['task-v2', task.status === 'completed' ? 'done' : '', justAdded ? 'just-added' : '', fresh ? 'is-fresh' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-task-id={task.id} style={{ borderLeft: `4px solid ${pm.color}`, ...(fresh ? FRESH_STYLE : {}) }}>
      <div className={`task-main ${isSub ? 'sub' : ''}`}>
        <div className="task-text">
          <div className="task-name">{task.title}</div>
          <div className="task-meta">
            {justAdded && <span className="just-added-tag">Just added ·</span>}
            <span>{STATUS_LABELS[task.status]}</span>
            <span>· {pm.label} · {ENERGY_META[task.energy_tag]?.label ?? 'Quick'}</span>
            {overdueDays > 0 && <span className="overdue">· <Clock size={11} aria-hidden="true" /> {overdueDays}d carried</span>}
            {hurdleCount > 0 && <span className="hurdle-count">· {hurdleCount} hurdle{hurdleCount > 1 ? 's' : ''}</span>}
            {task.scheduled_for && task.scheduled_for > today && <span>· {formatShort(task.scheduled_for)}</span>}
          </div>
        </div>
        <div className="task-btns">
          {task.status !== 'completed' && <button type="button" className="green" title="Done" aria-label={`Mark “${task.title}” done`} style={HIT} onClick={() => onAction('completed')}><Check size={16} aria-hidden="true" /></button>}
          {task.status === 'pending' && <button type="button" className="blue" title="Start" aria-label={`Start “${task.title}”`} style={HIT} onClick={() => onAction('ongoing')}><Play size={15} aria-hidden="true" /></button>}
          {task.status === 'completed' && <button type="button" title="Reopen" aria-label={`Reopen “${task.title}”`} style={HIT} onClick={() => onAction('pending')}><RotateCcw size={15} aria-hidden="true" /></button>}
          {task.status !== 'completed' && <button type="button" className={`orange ${openDrawer ? 'active' : ''}`} title="Flag a hurdle" aria-label={`Flag a hurdle on “${task.title}”`} aria-expanded={openDrawer} style={HIT} onClick={onEdit}><TriangleAlert size={15} aria-hidden="true" /></button>}
          <button type="button" className="red" title="Delete" aria-label={`Delete “${task.title}”`} style={HIT} onClick={onDelete}><X size={16} aria-hidden="true" /></button>
        </div>
      </div>
      {children}
    </div>
  );
}

function PendingRow({ p, onRetry, onDismiss }: { p: PendingAdd; onRetry: () => void; onDismiss: () => void }) {
  const pm = PRIORITY_META[p.priority];
  return (
    <div
      className={`task-v2 capture-row just-added is-${p.state}${p.state === 'saving' ? ' is-fresh' : ''}`}
      data-state={p.state}
      style={{ borderLeft: `4px solid ${pm.color}`, ...(p.state === 'saving' ? FRESH_STYLE : {}) }}
    >
      <div className="task-main">
        <div className="task-text">
          <div className="task-name">{p.title}</div>
          <div className="task-meta" role={p.state === 'error' ? 'alert' : 'status'}>
            {p.state === 'saving'
              ? <span><LoaderCircle size={11} className="spin" aria-hidden="true" /> Saving…</span>
              : <span className="capture-error"><CircleAlert size={11} aria-hidden="true" /> Not saved: {p.error}</span>}
          </div>
        </div>
        {p.state === 'error' && (
          <div className="task-btns">
            <button type="button" className="blue capture-retry" title="Retry" aria-label={`Retry saving “${p.title}”`} style={HIT} onClick={onRetry}><RotateCw size={15} aria-hidden="true" /></button>
            <button type="button" className="capture-dismiss" title="Dismiss" aria-label={`Dismiss “${p.title}”`} style={HIT} onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgendaView({ date, today, summary, onChanged }: Props) {
  const { tick } = useRefresh();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [someday, setSomeday] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [addHint, setAddHint] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [energy, setEnergy] = useState<EnergyTag>('quick');
  const [groupMode, setGroupMode] = useState<'priority' | 'status'>('priority');
  const [drawerTask, setDrawerTask] = useState<number | null>(null);
  const [drawerHurdles, setDrawerHurdles] = useState<Hurdle[]>([]);
  const [hurdleText, setHurdleText] = useState('');
  const [hurdleHint, setHurdleHint] = useState('');
  const [steps, setSteps] = useState<string[] | null>(null);
  const [showSomeday, setShowSomeday] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Record<number, string>>({});
  const [scheduleHint, setScheduleHint] = useState<number | null>(null);
  const [showAllMvd, setShowAllMvd] = useState(false);
  const [actionError, setActionError] = useState('');
  // Just-added task ids per date (newest first) and when their highlight ends.
  const [pinned, setPinned] = useState<{ date: string; ids: number[] }>({ date, ids: [] });
  const [freshUntil, setFreshUntil] = useState<Record<number, number>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hurdleInputRef = useRef<HTMLInputElement | null>(null);
  const actionGuard = useRef(createSubmitGuard(0));
  const recommended = summary?.capacity.mvdRecommended ?? false;
  const [mvd, setMvdState] = useState(() => getMvd(date, recommended));

  useEffect(() => { setMvdState(getMvd(date, recommended)); }, [date, recommended]);
  useEffect(() => {
    const onEvt = () => setMvdState(getMvd(date, recommended));
    window.addEventListener(MVD_EVENT, onEvt);
    return () => window.removeEventListener(MVD_EVENT, onEvt);
  }, [date, recommended]);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([getTasks(date), getSomedayTasks()]);
    setTasks(t.data);
    setSomeday(s.data);
  }, [date]);

  // A failed refetch keeps what is on screen (including optimistic rows) instead of blanking the list.
  useEffect(() => { load().catch(() => {}); }, [load, tick]);

  useEffect(() => {
    if (drawerTask == null) { setDrawerHurdles([]); return; }
    getTaskHurdles(drawerTask).then((r) => setDrawerHurdles(r.data)).catch(() => setDrawerHurdles([]));
  }, [drawerTask, tick]);

  const { pending, submit, retry, dismiss, settle } = useQuickAdd({
    onCreated: (task) => {
      setPinned((cur) => ({ date: task.date, ids: [task.id, ...(cur.date === task.date ? cur.ids.filter((i) => i !== task.id) : [])] }));
      setFreshUntil((cur) => ({ ...cur, [task.id]: Date.now() + HIGHLIGHT_MS }));
    },
    onAdded: onChanged,
  });

  // Once the refetched list contains a saved task, drop its optimistic entry (the id stays pinned).
  useEffect(() => { settle(settledTempIds(pending, tasks)); }, [pending, tasks, settle]);

  const pinnedIds = pinned.date === date ? pinned.ids : [];
  const now = useExpiring(Object.values(freshUntil));
  const isFresh = (id: number) => (freshUntil[id] ?? 0) > now;

  const refresh = async () => { await load(); onChanged(); };

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseQuickTitle(title);
    const outcome = submit({ title: parsed.title, date, priority: parsed.priority ?? priority, energy_tag: parsed.energy_tag ?? energy });
    if (outcome === 'empty') {
      setAddHint(EMPTY_HINT);
      inputRef.current?.focus();
      return;
    }
    setTitle('');
    setAddHint('');
    inputRef.current?.focus();
  };

  /** Optimistic, guarded mutation: apply locally, call the API, reconcile; on failure reload and explain. */
  const mutate = async (key: string, optimistic: ((ts: Task[]) => Task[]) | null, call: () => Promise<unknown>, failMsg: string) => {
    if (actionGuard.current.begin(key) !== 'ok') return false;
    setActionError('');
    const snapshot = tasks;
    if (optimistic) setTasks(optimistic);
    try {
      await call();
      await refresh().catch(() => {});
      return true;
    } catch (err) {
      setActionError(describeError(err, failMsg));
      await load().catch(() => setTasks(snapshot));
      return false;
    } finally {
      actionGuard.current.end(key);
    }
  };

  const act = (id: number, status: Task['status']) => mutate(
    `task:${id}`,
    (ts) => patchTask(ts, id, status === 'completed' ? { status, date, completed_at: new Date().toISOString() } : { status, completed_at: null }),
    () => updateTask(id, status === 'completed' ? { status, date } : { status }),
    status === 'completed' ? 'Couldn’t mark that done' : 'Couldn’t update that task',
  );
  const remove = (id: number) => {
    setSomeday((s) => s.filter((t) => t.id !== id));
    return mutate(`task:${id}`, (ts) => removeTask(ts, id), () => deleteTask(id), 'Couldn’t delete that task');
  };
  const triage = async (id: number, action: 'today' | 'schedule' | 'someday' | 'drop') => {
    if (action === 'schedule' && !scheduleFor[id]) {
      setScheduleHint(id);
      document.getElementById(`schedule-${id}`)?.focus();
      return;
    }
    setScheduleHint(null);
    const when = scheduleFor[id];
    await mutate(
      `task:${id}`,
      action === 'today' ? (ts) => patchTask(ts, id, { pool: 'today', date }) : (ts) => ts.filter((t) => t.id !== id),
      () => {
        if (action === 'today') return updateTask(id, { pool: 'today', date });
        if (action === 'schedule') return updateTask(id, { pool: 'scheduled', scheduled_for: when, date: when });
        if (action === 'someday') return updateTask(id, { pool: 'someday' });
        return updateTask(id, { pool: 'dropped' });
      },
      'Couldn’t move that task',
    );
  };

  const saveHurdle = async (taskId: number, text: string) => {
    if (!text.trim()) {
      setHurdleHint('Pick a chip or describe the blocker first.');
      hurdleInputRef.current?.focus();
      return;
    }
    setHurdleHint('');
    const ok = await mutate(`hurdle:${taskId}:${text.trim().toLowerCase()}`, null, () => createHurdle(taskId, text.trim()), 'Couldn’t log that hurdle');
    if (!ok) return;
    setHurdleText('');
    getTaskHurdles(taskId).then((r) => setDrawerHurdles(r.data)).catch(() => {});
  };
  const resolve = async (h: Hurdle) => {
    setDrawerHurdles((list) => list.map((x) => (x.id === h.id ? { ...x, resolved_at: new Date().toISOString() } : x)));
    await mutate(`resolve:${h.id}`, null, () => resolveHurdle(h.id, 'Resolved from Tasks'), 'Couldn’t resolve that hurdle');
    getTaskHurdles(h.task_id).then((r) => setDrawerHurdles(r.data)).catch(() => {});
  };
  const doSplit = async (taskId: number) => {
    if (!steps) return;
    const clean = steps.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const ok = await mutate(`split:${taskId}`, null, () => splitTask(taskId, clean, date), 'Couldn’t split that task');
    if (!ok) return;
    setSteps(null);
    setDrawerTask(null);
  };

  const hurdleCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const h of summary?.hurdles ?? []) m.set(h.task_id, (m.get(h.task_id) ?? 0) + 1);
    return m;
  }, [summary]);

  const byParent = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) if (t.parent_task_id != null) m.set(t.parent_task_id, [...(m.get(t.parent_task_id) ?? []), t]);
    return m;
  }, [tasks]);
  const topLevel = tasks.filter((t) => t.parent_task_id == null || !tasks.some((p) => p.id === t.parent_task_id));

  // Just-added rows are pinned above everything: never grouped, triaged or hidden by Minimum Viable Day.
  const { pinned: pinnedRows, rest } = mergeForDisplay(topLevel, pending, pinnedIds, date);

  const triageList = rest.filter((t) => t.status !== 'completed' && t.pool === 'today' && daysBetween(t.date, date) > TRIAGE_AFTER_DAYS);
  const triageIds = new Set(triageList.map((t) => t.id));
  const candidates = rest.filter((t) => !triageIds.has(t.id));
  const { shown: visible, hidden: mvdHidden } = applyMvd(candidates, mvd && !showAllMvd);

  const renderTask = (task: Task, isSub = false, justAdded = false) => {
    const subs = byParent.get(task.id) ?? [];
    const open = drawerTask === task.id;
    return (
      <TaskRow
        key={task.id}
        task={task}
        date={date}
        today={today}
        hurdleCount={hurdleCounts.get(task.id) ?? 0}
        isSub={isSub}
        openDrawer={open}
        justAdded={justAdded}
        fresh={justAdded && isFresh(task.id)}
        onAction={(s) => { void act(task.id, s); }}
        onEdit={() => { setDrawerTask(open ? null : task.id); setSteps(null); setHurdleText(''); setHurdleHint(''); }}
        onDelete={() => { void remove(task.id); }}
      >
        {open && (
          <div className="drawer">
            <div className="drawer-title">What’s in the way?</div>
            <div className="chip-row">
              {HURDLE_CHIPS.map((c) => (
                <button key={c} type="button" className="chip clickable tone-hurdle" style={{ minHeight: 40 }} onClick={() => saveHurdle(task.id, c)}>{c}</button>
              ))}
            </div>
            <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void saveHurdle(task.id, hurdleText); }}>
              <input ref={hurdleInputRef} className="input" placeholder="Describe the blocker…" value={hurdleText} aria-invalid={hurdleHint ? true : undefined} onChange={(e) => { setHurdleText(e.target.value); if (hurdleHint) setHurdleHint(''); }} style={{ minHeight: 40 }} />
              <button type="submit" className="btn-sm orange" style={HIT}>Log</button>
            </form>
            {hurdleHint && <div className="capture-hint" role="status">{hurdleHint}</div>}
            {drawerHurdles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drawerHurdles.map((h) => (
                  <div key={h.id} className={`hurdle-row ${h.resolved_at ? 'resolved' : ''}`}>
                    <span>{h.description}</span>
                    {!h.resolved_at && <button type="button" className="btn-xs green" style={{ minHeight: 40 }} onClick={() => resolve(h)}>Resolved</button>}
                  </div>
                ))}
              </div>
            )}
            <div className="drawer-title drawer-title-unblock" style={{ marginTop: 4 }}>Unblock it</div>
            {steps == null ? (
              <div className="chip-row">
                <button type="button" className="btn-xs blue" style={{ minHeight: 40 }} onClick={() => setSteps(microStepTemplates(task.title))}>Split into 3 micro-steps</button>
                <button type="button" className="btn-xs" style={{ minHeight: 40 }} onClick={() => act(task.id, 'ongoing')}>Just start (2 min)</button>
                <button type="button" className="btn-xs" style={{ minHeight: 40 }} onClick={() => triage(task.id, 'someday')}>Park in Someday</button>
              </div>
            ) : (
              <div className="steps-grid">
                {steps.map((s, i) => (
                  <input key={i} className="input" style={{ minHeight: 40 }} value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                <div className="chip-row">
                  <button type="button" className="btn-sm blue" style={{ minHeight: 40 }} onClick={() => doSplit(task.id)}>Create steps</button>
                  <button type="button" className="btn-sm" style={{ minHeight: 40 }} onClick={() => setSteps(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {subs.map((s) => renderTask(s, true))}
      </TaskRow>
    );
  };

  const groupedByPriority = PRIORITY_ORDER.map((p) => ({ p, items: visible.filter((t) => t.priority === p) }));
  const groupedByStatus = (['needs_attention', 'ongoing', 'pending', 'completed'] as Task['status'][]).map((s) => ({ s, items: visible.filter((t) => t.status === s) }));
  const openShown = visible.filter((t) => t.status !== 'completed').length;

  return (
    <div className="panel">
      <form className="task-add-form" onSubmit={handleAdd} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (addHint) setAddHint(''); }}
            placeholder="Add a task… (Enter)"
            aria-label="New task"
            aria-invalid={addHint ? true : undefined}
            enterKeyHint="done"
            className="input"
            style={{ flex: 1, minWidth: 0, minHeight: 40 }}
          />
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="select" aria-label="Priority" style={{ flexShrink: 0, width: 120, minHeight: 40 }}>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="energy-chips">
          {(Object.keys(ENERGY_META) as EnergyTag[]).map((e) => (
            <button key={e} type="button" aria-pressed={energy === e} className={`energy-chip ${energy === e ? 'active' : ''}`} style={{ minHeight: 40 }} onClick={() => setEnergy(e)}>{ENERGY_META[e].label}</button>
          ))}
          <button type="submit" className="btn-xs blue task-add-btn" style={{ marginLeft: 'auto', ...HIT }}>
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        </div>
        {addHint && <div className="capture-hint" role="status">{addHint}</div>}
      </form>

      {actionError && (
        <div className="capture-error-banner" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span><CircleAlert size={14} aria-hidden="true" /> {actionError}</span>
          <button type="button" className="btn-xs" style={HIT} aria-label="Dismiss error" onClick={() => setActionError('')}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {pinnedRows.length > 0 && (
        <div className="just-added-strip" aria-live="polite">
          {pinnedRows.map((row) => row.kind === 'pending'
            ? <PendingRow key={row.key} p={row.pending} onRetry={() => retry(row.pending.tempId)} onDismiss={() => dismiss(row.pending.tempId)} />
            : renderTask(row.task, false, true))}
        </div>
      )}

      {mvd && (
        <div className="mvd-banner">
          <span>Minimum Viable Day: showing your top {Math.min(2, openShown)} open tasks{mvdHidden.length > 0 ? ` · ${mvdHidden.length} parked for later` : ''}.</span>
          <button type="button" className="btn-xs" style={{ minHeight: 40 }} onClick={() => setShowAllMvd((v) => !v)}>{showAllMvd ? 'Top 2 only' : 'Show all'}</button>
        </div>
      )}

      {triageList.length > 0 && (
        <div className="card triage">
          <div className="card-title">15-second triage · {triageList.length} task{triageList.length > 1 ? 's' : ''} older than {TRIAGE_AFTER_DAYS} days</div>
          <div style={{ position: 'relative' }}>
            {triageList.map((t) => (
              <div key={t.id} className="triage-item">
                <div className="triage-title">{t.title}<small>{daysBetween(t.date, date)}d carried</small></div>
                <div className="triage-actions">
                  <button type="button" className="btn-xs green" style={{ minHeight: 40 }} onClick={() => triage(t.id, 'today')}>Do today</button>
                  <input id={`schedule-${t.id}`} type="date" className="btn-xs" aria-label={`Schedule date for ${t.title}`} style={{ minHeight: 40 }} value={scheduleFor[t.id] ?? ''} onChange={(e) => { setScheduleFor({ ...scheduleFor, [t.id]: e.target.value }); setScheduleHint(null); }} />
                  <button type="button" className="btn-xs blue" style={{ minHeight: 40 }} onClick={() => triage(t.id, 'schedule')}><CalendarClock size={13} aria-hidden="true" /> Schedule</button>
                  <button type="button" className="btn-xs" style={{ minHeight: 40 }} onClick={() => triage(t.id, 'someday')}>Someday</button>
                  <button type="button" className="btn-xs red" style={{ minHeight: 40 }} onClick={() => triage(t.id, 'drop')}>Drop</button>
                </div>
                {scheduleHint === t.id && <div className="capture-hint" role="status">Pick a date first, then Schedule.</div>}
              </div>
            ))}
            <p className="muted">Carried-over tasks stop nagging after two days. Decide once; nothing is lost. Someday items live in the vault below.</p>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Group tasks">
          {(['priority', 'status'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={groupMode === mode} className={`range-tab ${groupMode === mode ? 'active' : ''}`} style={{ minHeight: 40 }} onClick={() => setGroupMode(mode)}>{mode === 'priority' ? 'By priority' : 'By status'}</button>
          ))}
        </div>
      )}

      {visible.length === 0 && triageList.length === 0 && pinnedRows.length === 0 && <p className="empty">Nothing on the board for this day. Add a task above or tell the Omni-Bar “todo: …”.</p>}

      {visible.length > 0 && groupMode === 'priority' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {groupedByPriority.map(({ p, items }) => items.length === 0 ? null : (
            <div key={p} className="group-wrap">
              <div className="group-head" style={{ color: PRIORITY_META[p].color, background: PRIORITY_META[p].bg }}>
                <span>{PRIORITY_META[p].label}</span>
                <span>{items.filter((t) => t.status === 'completed').length}/{items.length}</span>
              </div>
              {items.map((t) => renderTask(t))}
            </div>
          ))}
        </div>
      )}

      {visible.length > 0 && groupMode === 'status' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {groupedByStatus.map(({ s, items }) => items.length === 0 ? null : (
            <div key={s}>
              <div className="status-head" style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{STATUS_LABELS[s]}</div>
              {items.map((t) => renderTask(t))}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <button type="button" className="someday-head" aria-expanded={showSomeday} onClick={() => setShowSomeday((v) => !v)} style={{ width: '100%', minHeight: 40, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left' }}>
          <span className="card-title" style={{ marginBottom: 0 }}><Archive size={14} aria-hidden="true" /> Someday vault · {someday.length}</span>
          {showSomeday ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
        {showSomeday && (
          <div style={{ marginTop: 12, position: 'relative' }}>
            {someday.length === 0 ? <p className="muted">Empty. Park ideas here instead of dropping them.</p> : someday.map((t) => (
              <div key={t.id} className="hurdle-row" style={{ marginBottom: 6 }}>
                <span>{t.title}</span>
                <div className="chip-row">
                  <button type="button" className="btn-xs green" style={{ minHeight: 40 }} onClick={() => { setSomeday((s) => s.filter((x) => x.id !== t.id)); void triage(t.id, 'today'); }}>Bring back</button>
                  <button type="button" className="btn-xs red" style={HIT} aria-label={`Delete ${t.title}`} onClick={() => remove(t.id)}><X size={14} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
