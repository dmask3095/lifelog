import { useState, useEffect } from 'react';
import { getTasks, createTask, updateTask, deleteTask } from '../api';

interface Task {
  id: number;
  title: string;
  status: 'pending' | 'ongoing' | 'completed' | 'needs_attention';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  date: string;
}

interface Props { date: string; }

const PRIORITY_CONFIG = {
  urgent: { color: '#ff4444', bg: '#1a0000', label: '🔴 Urgent' },
  high:   { color: '#ff8800', bg: '#1a0d00', label: '🟠 High' },
  medium: { color: '#4488ff', bg: '#001833', label: '🔵 Medium' },
  low:    { color: '#666666', bg: '#141414', label: '⚫ Low' },
};

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const;
const STATUS_ORDER = ['needs_attention', 'ongoing', 'pending', 'completed'] as const;

const STATUS_ACTIONS = {
  pending:         ['complete', 'start', 'flag'],
  ongoing:         ['complete', 'flag'],
  needs_attention: ['complete', 'start'],
  completed:       ['flag'],
};

const ACTION_BTN: Record<string, { label: string; cls: string; nextStatus: string; tooltip: string }> = {
  complete: { label: '✓', cls: 'green', nextStatus: 'completed', tooltip: 'Mark it done. Queue the tiny victory confetti.' },
  start:    { label: '▶', cls: 'blue',  nextStatus: 'ongoing', tooltip: 'Start this quest. Momentum likes a dramatic entrance.' },
  flag:     { label: '⚠', cls: 'orange', nextStatus: 'needs_attention', tooltip: 'Wave a tiny caution flag. This one needs backup.' },
};

const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ Pending',
  ongoing: '🔄 Ongoing',
  completed: '✅ Completed',
  needs_attention: '⚠️ Needs Attention',
};

type GroupMode = 'priority' | 'status';

export default function AgendaView({ date }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [groupMode, setGroupMode] = useState<GroupMode>('priority');
  const [loading, setLoading] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<Task['priority']>('medium');
  const [savingEdit, setSavingEdit] = useState(false);

  const sortTasks = (items: Task[]) => [...items].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;

    return a.id - b.id;
  });

  const fetchTasks = async () => {
    const res = await getTasks(date);
    setTasks(sortTasks(res.data));
  };

  useEffect(() => { fetchTasks(); }, [date]);

  const handleAdd = async () => {
    if (!title.trim()) return;
    setLoading(true);
    await createTask({ title, priority, date });
    setTitle('');
    await fetchTasks();
    setLoading(false);
  };

  const handleAction = async (id: number, nextStatus: string) => {
    await updateTask(id, { status: nextStatus });
    await fetchTasks();
  };

  const handleDelete = async (id: number) => {
    await deleteTask(id);
    await fetchTasks();
  };

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditTitle('');
    setEditPriority('medium');
    setSavingEdit(false);
  };

  const handleSaveEdit = async () => {
    if (editingTaskId === null || !editTitle.trim()) return;

    setSavingEdit(true);
    try {
      await updateTask(editingTaskId, {
        title: editTitle.trim(),
        priority: editPriority,
      });
      await fetchTasks();
      cancelEditing();
    } finally {
      setSavingEdit(false);
    }
  };

  const renderTask = (task: Task) => {
    const isEditing = editingTaskId === task.id;

    return (
      <div key={task.id} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 16px', background: '#1a1a1a', borderRadius: 12,
        border: `1px solid #242424`,
        borderLeft: `4px solid ${PRIORITY_CONFIG[task.priority].color}`,
        marginBottom: 8, minHeight: 56, gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          {isEditing ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveEdit();
                  if (e.key === 'Escape') cancelEditing();
                }}
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                placeholder="Task title..."
              />
              <select
                value={editPriority}
                onChange={e => setEditPriority(e.target.value as Task['priority'])}
                className="select"
                style={{ minWidth: 130 }}
              >
                <option value="urgent">🔴 Urgent</option>
                <option value="high">🟠 High</option>
                <option value="medium">🔵 Medium</option>
                <option value="low">⚫ Low</option>
              </select>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, color: task.status === 'completed' ? '#444' : '#e8e8e8',
                textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>
                {task.title}
              </div>
              {groupMode === 'priority' && (
                <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                  {STATUS_LABELS[task.status]}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isEditing ? (
            <>
              <button
                className="btn-sm green"
                onClick={handleSaveEdit}
                disabled={savingEdit || !editTitle.trim()}
              >
                {savingEdit ? '...' : 'Save'}
              </button>
              <button className="btn-sm" onClick={cancelEditing}>Cancel</button>
            </>
          ) : (
            <>
              {(STATUS_ACTIONS[task.status] || []).map(action => (
                <button key={action}
                  className={`btn-sm tooltip-trigger ${ACTION_BTN[action].cls}`}
                  onClick={() => handleAction(task.id, ACTION_BTN[action].nextStatus)}
                  data-tooltip={ACTION_BTN[action].tooltip}
                  aria-label={ACTION_BTN[action].tooltip}>
                  {ACTION_BTN[action].label}
                </button>
              ))}
              <button
                className="btn-sm blue tooltip-trigger"
                onClick={() => startEditing(task)}
                data-tooltip="Rewrite the mission. Same task, fresher words."
                aria-label="Edit this task"
              >
                ✎
              </button>
              <button
                className="btn-sm red tooltip-trigger"
                onClick={() => handleDelete(task.id)}
                data-tooltip="Poof. Send this task back to the void."
                aria-label="Delete this task"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderByPriority = () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {(['urgent', 'high', 'medium', 'low'] as const).map(p => {
        const group = tasks.filter(t => t.priority === p);
        const cfg = PRIORITY_CONFIG[p];
        return (
          <div key={p} style={{
            padding: 12,
            borderRadius: 16,
            background: '#121212',
            border: `1px solid ${cfg.color}33`,
            boxShadow: `inset 0 0 0 1px ${cfg.color}12`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', background: cfg.bg,
              borderRadius: 10, marginBottom: group.length > 0 ? 10 : 0,
              border: `1px solid ${cfg.color}33`,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
              <span style={{ fontSize: 12, color: cfg.color, background: `${cfg.color}22`, padding: '2px 8px', borderRadius: 10 }}>
                {group.filter(t => t.status === 'completed').length}/{group.length}
              </span>
            </div>
            {group.length > 0 ? (
              group.map(renderTask)
            ) : (
              <div style={{
                minHeight: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                border: '1px dashed #2a2a2a',
                color: '#555',
                fontSize: 13,
              }}>
                No {p} tasks yet.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderByStatus = () => (
    <>
      {(['needs_attention', 'ongoing', 'pending', 'completed'] as const).map(s => {
        const group = tasks.filter(t => t.status === s);
        if (group.length === 0) return null;
        return (
          <div key={s}>
            <div style={{ fontSize: 11, color: '#555', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, paddingLeft: 2 }}>
              {STATUS_LABELS[s]}
            </div>
            {group.map(renderTask)}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="panel">

      {/* Add task form */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add a task..." className="input" style={{ flex: 1 }} />
        <select value={priority} onChange={e => setPriority(e.target.value as Task['priority'])} className="select">
          <option value="urgent">🔴 Urgent</option>
          <option value="high">🟠 High</option>
          <option value="medium">🔵 Medium</option>
          <option value="low">⚫ Low</option>
        </select>
      </div>
      <button onClick={handleAdd} disabled={loading || !title.trim()} className="btn-primary">
        {loading ? 'Adding...' : '+ Add Task'}
      </button>

      {/* Summary bar */}
      {tasks.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['urgent','high','medium','low'] as const).map(p => {
            const count = tasks.filter(t => t.priority === p && t.status !== 'completed').length;
            if (count === 0) return null;
            return (
              <div key={p} style={{ padding: '4px 10px', borderRadius: 20, background: `${PRIORITY_CONFIG[p].color}22`, border: `1px solid ${PRIORITY_CONFIG[p].color}44`, fontSize: 12, color: PRIORITY_CONFIG[p].color }}>
                {count} {p}
              </div>
            );
          })}
        </div>
      )}

      {/* Group mode toggle */}
      {tasks.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['priority', 'status'] as GroupMode[]).map(mode => (
            <button key={mode} onClick={() => setGroupMode(mode)} style={{
              padding: '8px 14px', borderRadius: 20, border: 'none',
              background: groupMode === mode ? '#4488ff' : '#1a1a1a',
              color: groupMode === mode ? '#fff' : '#555',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {mode === 'priority' ? '🎯 By Priority' : '📋 By Status'}
            </button>
          ))}
        </div>
      )}

      {/* Task groups */}
      {tasks.length === 0
        ? <p className="empty">No tasks for today. Add one above.</p>
        : groupMode === 'priority' ? renderByPriority() : renderByStatus()
      }

    </div>
  );
}
