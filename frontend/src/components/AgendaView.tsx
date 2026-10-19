import { useCallback, useEffect, useMemo, useState } from 'react';
import { createHurdle, createTask, deleteTask, getSomedayTasks, getTaskHurdles, getTasks, resolveHurdle, splitTask, updateTask } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { daysBetween, formatShort } from '../lib/dates';
import { getMvd, MVD_EVENT } from '../lib/mvd';
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

function microStepTemplates(title: string): string[] {
  return [
    `Open everything needed for “${title}” (10 min)`,
    `Write the ugly first version of “${title}” (10 min)`,
    `Define what “done” looks like for “${title}” and finish one piece`,
  ];
}

function TaskRow({ task, children, date, today, hurdleCount, isSub, openDrawer, onAction, onEdit, onDelete }: {
  task: Task; children?: React.ReactNode; date: string; today: string; hurdleCount: number; isSub: boolean;
  openDrawer: boolean; onAction: (status: Task['status']) => void; onEdit: () => void; onDelete: () => void;
}) {
  const overdueDays = task.status !== 'completed' && task.date < date ? daysBetween(task.date, date) : 0;
  const pm = PRIORITY_META[task.priority];
  return (
    <div className={`task-v2 ${task.status === 'completed' ? 'done' : ''}`} style={{ borderLeft: `4px solid ${pm.color}` }}>
      <div className={`task-main ${isSub ? 'sub' : ''}`}>
        <div className="task-text">
          <div className="task-name">{task.title}</div>
          <div className="task-meta">
            <span>{STATUS_LABELS[task.status]}</span>
            <span>· {ENERGY_META[task.energy_tag]?.icon ?? '⚡'} {ENERGY_META[task.energy_tag]?.label ?? 'Quick'}</span>
            {overdueDays > 0 && <span className="overdue">· ⏰ {overdueDays}d carried</span>}
            {hurdleCount > 0 && <span className="hurdle-count">· ⚠ {hurdleCount} hurdle{hurdleCount > 1 ? 's' : ''}</span>}
            {task.scheduled_for && task.scheduled_for > today && <span>· 📅 {formatShort(task.scheduled_for)}</span>}
          </div>
        </div>
        <div className="task-btns">
          {task.status !== 'completed' && <button className="green" title="Done" onClick={() => onAction('completed')}>✓</button>}
          {task.status === 'pending' && <button className="blue" title="Start" onClick={() => onAction('ongoing')}>▶</button>}
          {task.status === 'completed' && <button title="Reopen" onClick={() => onAction('pending')}>↺</button>}
          {task.status !== 'completed' && <button className={`orange ${openDrawer ? 'active' : ''}`} title="Flag a hurdle" onClick={onEdit}>⚠</button>}
          <button className="red" title="Delete" onClick={onDelete}>✕</button>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function AgendaView({ date, today, summary, onChanged }: Props) {
  const { tick } = useRefresh();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [someday, setSomeday] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [energy, setEnergy] = useState<EnergyTag>('quick');
  const [adding, setAdding] = useState(false);
  const [groupMode, setGroupMode] = useState<'priority' | 'status'>('priority');
  const [drawerTask, setDrawerTask] = useState<number | null>(null);
  const [drawerHurdles, setDrawerHurdles] = useState<Hurdle[]>([]);
  const [hurdleText, setHurdleText] = useState('');
  const [steps, setSteps] = useState<string[] | null>(null);
  const [showSomeday, setShowSomeday] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Record<number, string>>({});
  const [showAllMvd, setShowAllMvd] = useState(false);
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

  useEffect(() => { load().catch(() => setTasks([])); }, [load, tick]);

  useEffect(() => {
    if (drawerTask == null) { setDrawerHurdles([]); return; }
    getTaskHurdles(drawerTask).then((r) => setDrawerHurdles(r.data)).catch(() => setDrawerHurdles([]));
  }, [drawerTask, tick]);

  const refresh = async () => { await load(); onChanged(); };

  const handleAdd = async () => {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await createTask({ title: title.trim(), priority, date, energy_tag: energy });
      setTitle('');
      await refresh();
    } finally { setAdding(false); }
  };

  const act = async (id: number, status: Task['status']) => {
    await updateTask(id, status === 'completed' ? { status, date } : { status });
    await refresh();
  };
  const remove = async (id: number) => { await deleteTask(id); await refresh(); };
  const triage = async (id: number, action: 'today' | 'schedule' | 'someday' | 'drop') => {
    if (action === 'today') await updateTask(id, { pool: 'today', date });
    if (action === 'schedule') {
      const when = scheduleFor[id];
      if (!when) return;
      await updateTask(id, { pool: 'scheduled', scheduled_for: when, date: when });
    }
    if (action === 'someday') await updateTask(id, { pool: 'someday' });
    if (action === 'drop') await updateTask(id, { pool: 'dropped' });
    await refresh();
  };

  const saveHurdle = async (taskId: number, text: string) => {
    if (!text.trim()) return;
    await createHurdle(taskId, text.trim());
    setHurdleText('');
    const r = await getTaskHurdles(taskId);
    setDrawerHurdles(r.data);
    await refresh();
  };
  const resolve = async (h: Hurdle) => {
    await resolveHurdle(h.id, 'Resolved from Tasks');
    const r = await getTaskHurdles(h.task_id);
    setDrawerHurdles(r.data);
    await refresh();
  };
  const doSplit = async (taskId: number) => {
    if (!steps) return;
    const clean = steps.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return;
    await splitTask(taskId, clean, date);
    setSteps(null);
    setDrawerTask(null);
    await refresh();
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

  const triageList = topLevel.filter((t) => t.status !== 'completed' && t.pool === 'today' && daysBetween(t.date, date) > TRIAGE_AFTER_DAYS);
  const triageIds = new Set(triageList.map((t) => t.id));

  let visible = topLevel.filter((t) => !triageIds.has(t.id));
  const mvdHidden = mvd && !showAllMvd
    ? visible.filter((t) => t.status !== 'completed').slice(2)
    : [];
  if (mvd && !showAllMvd) {
    const open = visible.filter((t) => t.status !== 'completed');
    const keep = new Set(open.slice(0, 2).map((t) => t.id));
    visible = visible.filter((t) => t.status === 'completed' || keep.has(t.id));
  }

  const renderTask = (task: Task, isSub = false) => {
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
        onAction={(s) => act(task.id, s)}
        onEdit={() => { setDrawerTask(open ? null : task.id); setSteps(null); setHurdleText(''); }}
        onDelete={() => remove(task.id)}
      >
        {open && (
          <div className="drawer">
            <div className="drawer-title">What’s in the way?</div>
            <div className="chip-row">
              {HURDLE_CHIPS.map((c) => (
                <button key={c} type="button" className="chip clickable tone-hurdle" onClick={() => saveHurdle(task.id, c)}>{c}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="Describe the blocker…" value={hurdleText} onChange={(e) => setHurdleText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveHurdle(task.id, hurdleText)} />
              <button className="btn-sm orange" onClick={() => saveHurdle(task.id, hurdleText)} disabled={!hurdleText.trim()}>Log</button>
            </div>
            {drawerHurdles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drawerHurdles.map((h) => (
                  <div key={h.id} className={`hurdle-row ${h.resolved_at ? 'resolved' : ''}`}>
                    <span>{h.description}</span>
                    {!h.resolved_at && <button className="btn-xs green" onClick={() => resolve(h)}>Resolved</button>}
                  </div>
                ))}
              </div>
            )}
            <div className="drawer-title" style={{ color: '#7dd5ff', marginTop: 4 }}>Unblock it</div>
            {steps == null ? (
              <div className="chip-row">
                <button className="btn-xs blue" onClick={() => setSteps(microStepTemplates(task.title))}>Split into 3 micro-steps</button>
                <button className="btn-xs" onClick={() => act(task.id, 'ongoing')}>Just start (2 min)</button>
                <button className="btn-xs" onClick={() => triage(task.id, 'someday')}>Park in Someday</button>
              </div>
            ) : (
              <div className="steps-grid">
                {steps.map((s, i) => (
                  <input key={i} className="input" value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                <div className="chip-row">
                  <button className="btn-sm blue" onClick={() => doSplit(task.id)}>Create steps</button>
                  <button className="btn-sm" onClick={() => setSteps(null)}>Cancel</button>
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

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} placeholder="Add a task…" className="input" style={{ flex: 1, minWidth: 0 }} />
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="select" style={{ flexShrink: 0, width: 120 }}>
          <option value="urgent">🔴 Urgent</option>
          <option value="high">🟠 High</option>
          <option value="medium">🔵 Medium</option>
          <option value="low">⚫ Low</option>
        </select>
      </div>
      <div className="energy-chips">
        {(Object.keys(ENERGY_META) as EnergyTag[]).map((e) => (
          <button key={e} type="button" className={`energy-chip ${energy === e ? 'active' : ''}`} onClick={() => setEnergy(e)}>{ENERGY_META[e].icon} {ENERGY_META[e].label}</button>
        ))}
        <button onClick={handleAdd} disabled={adding || !title.trim()} className="btn-xs blue" style={{ marginLeft: 'auto' }}>{adding ? 'Adding…' : '+ Add'}</button>
      </div>

      {mvd && (
        <div className="mvd-banner">
          <span>🌿 Minimum Viable Day: showing your top {Math.min(2, visible.filter((t) => t.status !== 'completed').length)} open tasks{mvdHidden.length > 0 ? ` · ${mvdHidden.length} parked for later` : ''}.</span>
          <button className="btn-xs" onClick={() => setShowAllMvd((v) => !v)}>{showAllMvd ? 'Top 2 only' : 'Show all'}</button>
        </div>
      )}

      {triageList.length > 0 && (
        <div className="card triage">
          <div className="card-title">⏳ 15-second triage · {triageList.length} task{triageList.length > 1 ? 's' : ''} older than {TRIAGE_AFTER_DAYS} days</div>
          <div style={{ position: 'relative' }}>
            {triageList.map((t) => (
              <div key={t.id} className="triage-item">
                <div className="triage-title">{t.title}<small>{daysBetween(t.date, date)}d carried</small></div>
                <div className="triage-actions">
                  <button className="btn-xs green" onClick={() => triage(t.id, 'today')}>Do today</button>
                  <input type="date" className="btn-xs" value={scheduleFor[t.id] ?? ''} onChange={(e) => setScheduleFor({ ...scheduleFor, [t.id]: e.target.value })} />
                  <button className="btn-xs blue" disabled={!scheduleFor[t.id]} onClick={() => triage(t.id, 'schedule')}>Schedule</button>
                  <button className="btn-xs" onClick={() => triage(t.id, 'someday')}>Someday</button>
                  <button className="btn-xs red" onClick={() => triage(t.id, 'drop')}>Drop</button>
                </div>
              </div>
            ))}
            <p className="muted">Carried-over tasks stop nagging after two days. Decide once; nothing is lost. Someday items live in the vault below.</p>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['priority', 'status'] as const).map((mode) => (
            <button key={mode} className={`range-tab ${groupMode === mode ? 'active' : ''}`} onClick={() => setGroupMode(mode)}>{mode === 'priority' ? '🎯 By priority' : '📋 By status'}</button>
          ))}
        </div>
      )}

      {visible.length === 0 && triageList.length === 0 && <p className="empty">Nothing on the board for this day. Add a task above or tell the Omni-Bar what you need to do.</p>}

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
              <div style={{ fontSize: 11, color: '#6f829a', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{STATUS_LABELS[s]}</div>
              {items.map((t) => renderTask(t))}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="someday-head" onClick={() => setShowSomeday((v) => !v)}>
          <div className="card-title" style={{ marginBottom: 0 }}>🗄 Someday vault · {someday.length}</div>
          <span style={{ color: '#6f829a' }}>{showSomeday ? '▾' : '▸'}</span>
        </div>
        {showSomeday && (
          <div style={{ marginTop: 12, position: 'relative' }}>
            {someday.length === 0 ? <p className="muted">Empty. Park ideas here instead of dropping them.</p> : someday.map((t) => (
              <div key={t.id} className="hurdle-row" style={{ marginBottom: 6 }}>
                <span>{t.title}</span>
                <div className="chip-row">
                  <button className="btn-xs green" onClick={() => triage(t.id, 'today')}>Bring back</button>
                  <button className="btn-xs red" onClick={() => remove(t.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
