import { useEffect, useState } from 'react';
import { createTask, deleteTask, getJournal, saveJournal, saveMood } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { formatShort } from '../lib/dates';
import type { SummaryData } from '../types';

interface Props { date: string; today: string; summary: SummaryData; autoOpen: boolean; }

const MOODS = [
  { score: 1, emoji: '😞', label: 'Rough' }, { score: 2, emoji: '😕', label: 'Low' }, { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' }, { score: 5, emoji: '🤩', label: 'Great' },
];

const closedKey = (date: string) => `lifelog.closed.${date}`;
const lightsKey = (date: string) => `lifelog.lightsout.${date}`;

// Evening close: mood, one win, tomorrow's top tasks with a when/where cue, lights-out time.
// Masicampo & Baumeister (2011): a concrete plan for an unfinished goal removes the intrusive
// thoughts; Scullin et al. (2018): a 5-minute bedtime to-do list speeds sleep onset.
export default function CloseDayCard({ date, today, summary, autoOpen }: Props) {
  const { bump } = useRefresh();
  const isToday = date === today;
  const hour = new Date().getHours();
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(closedKey(date)) === '1'; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<number | null>(summary.mood?.score ?? null);
  const [win, setWin] = useState('');
  const [tasks, setTasks] = useState(['', '', '']);
  const [cues, setCues] = useState(['', '', '']);
  const [lightsOut, setLightsOut] = useState(() => { try { return localStorage.getItem(lightsKey(date)) || '23:00'; } catch { return '23:00'; } });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setClosed((() => { try { return localStorage.getItem(closedKey(date)) === '1'; } catch { return false; } })());
    setMood(summary.mood?.score ?? null);
  }, [date, summary.mood?.score]);

  useEffect(() => {
    if (autoOpen) setOpen(true);
    else setOpen(isToday && hour >= 18 && !closed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, date]);

  const tomorrow = summary.tomorrow;

  const save = async () => {
    setSaving(true);
    try {
      if (mood != null && mood !== summary.mood?.score) await saveMood(date, mood, '');
      if (win.trim()) {
        const existing = await getJournal(date);
        const label = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const note = `${label}\nWin: ${win.trim()}`;
        await saveJournal(date, existing.data?.content ? `${existing.data.content}\n\n${note}` : note);
      }
      let order = 0;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i].trim();
        if (!t) continue;
        await createTask({ title: t, priority: order === 0 ? 'high' : 'medium', date: tomorrow.date, energy_tag: order === 0 ? 'deep' : 'quick', description: cues[i].trim() ? `When/where: ${cues[i].trim()}` : null });
        order++;
      }
      try { localStorage.setItem(closedKey(date), '1'); localStorage.setItem(lightsKey(date), lightsOut); } catch { /* ignore */ }
      setClosed(true);
      setOpen(false);
      setWin('');
      setTasks(['', '', '']);
      setCues(['', '', '']);
      bump();
    } finally { setSaving(false); }
  };

  const removeTomorrow = async (id: number) => { await deleteTask(id); bump(); };

  if (!open) {
    return (
      <div className={`card close-card ${closed ? 'closed' : ''}`}>
        <div className="close-head">
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>{closed ? '🌙 Day closed' : '🌙 Close the day'}</div>
            <div className="muted">
              {closed
                ? `Tomorrow has ${tomorrow.count} task${tomorrow.count === 1 ? '' : 's'} lined up · lights out ${lightsOut}. Sleep well.`
                : tomorrow.count > 0
                  ? `Tomorrow already has ${tomorrow.count} task${tomorrow.count === 1 ? '' : 's'}. Add a win and a lights-out time in 60 seconds.`
                  : 'Mood, one win, tomorrow’s top 1–3. Sixty seconds, then your brain can let go.'}
            </div>
          </div>
          <button className={`btn-sm ${closed ? '' : 'blue'}`} onClick={() => setOpen(true)}>{closed ? 'Edit' : 'Start'}</button>
        </div>
        {tomorrow.count > 0 && (
          <div className="tomorrow-list">
            {tomorrow.items.map((t) => (
              <div key={t.id} className="tomorrow-item">
                <span>{t.title}{t.description ? <small> · {t.description.replace('When/where: ', '')}</small> : null}</span>
                <button className="habit-delete" onClick={() => removeTomorrow(t.id)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card close-card">
      <div className="card-title">🌙 Close the day · {formatShort(date)}</div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="setup-step">How did today feel, honestly?</div>
          <div className="mood-row">
            {MOODS.map((m) => (
              <button key={m.score} className={`mood-btn ${mood === m.score ? 'selected' : ''}`} onClick={() => setMood(m.score)}>{m.emoji}<span>{m.label}</span></button>
            ))}
          </div>
        </div>
        <div>
          <div className="setup-step">One win, however small</div>
          <input className="input" value={win} onChange={(e) => setWin(e.target.value)} placeholder={summary.tasks.completed > 0 ? `e.g. shipped ${summary.tasks.completed} task${summary.tasks.completed === 1 ? '' : 's'} on a ${summary.capacity.level} day` : 'e.g. got out of bed and showed up'} />
        </div>
        <div>
          <div className="setup-step">Tomorrow’s top 1–3 (add when & where, your brain follows cues better than wishes)</div>
          <div className="form-stack">
            {tasks.map((t, i) => (
              <div key={i} className="cue-row">
                <input className="input" value={t} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? 'The one that matters most' : 'Optional'} />
                <input className="input cue-input" value={cues[i]} onChange={(e) => setCues(cues.map((x, j) => (j === i ? e.target.value : x)))} placeholder="after coffee, at my desk" />
              </div>
            ))}
          </div>
          {tomorrow.count > 0 && <p className="muted" style={{ marginTop: 6 }}>Already planned for tomorrow: {tomorrow.items.map((t) => t.title).join(' · ')}</p>}
        </div>
        <div className="close-foot">
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Lights out
            <input type="time" className="btn-xs" value={lightsOut} onChange={(e) => setLightsOut(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-sm" onClick={() => setOpen(false)}>Later</button>
            <button className="btn-sm green" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Close the day'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
