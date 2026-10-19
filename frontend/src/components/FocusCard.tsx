import { useEffect, useRef, useState } from 'react';
import { postTime, updateTask } from '../api';
import type { Task, TimeCategory } from '../types';

interface Props {
  task: Task;
  date: string;
  onDone: () => void;
  onStuck: () => void;
  onClose: () => void;
}

const PRESETS = [10, 25, 50];
const CATEGORY_FOR_ENERGY: Record<Task['energy_tag'], TimeCategory> = { deep: 'deep_work', admin: 'admin', quick: 'admin', recovery: 'rested' };

// "Just ten minutes": one task, one tiny first move, a visible timer. Stopping when the
// timer ends still counts; the minutes are logged under the task's energy category.
export default function FocusCard({ task, date, onDone, onStuck, onClose }: Props) {
  const [target, setTarget] = useState(10);
  const [remaining, setRemaining] = useState(10 * 60);
  const [running, setRunning] = useState(false);
  const [firstMove, setFirstMove] = useState(`Open what “${task.title}” needs and do the smallest visible step`);
  const startedAt = useRef<number | null>(null);
  const elapsedBefore = useRef(0);
  const [logged, setLogged] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const elapsed = elapsedBefore.current + (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      const left = Math.max(0, target * 60 - elapsed);
      setRemaining(left);
      if (left <= 0) { setRunning(false); startedAt.current = null; elapsedBefore.current = target * 60; }
    }, 500);
    return () => window.clearInterval(id);
  }, [running, target]);

  const elapsedMinutes = () => Math.round((elapsedBefore.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0)) / 60);
  const start = () => { startedAt.current = Date.now(); setRunning(true); };
  const pause = () => { if (startedAt.current) elapsedBefore.current += (Date.now() - startedAt.current) / 1000; startedAt.current = null; setRunning(false); };
  const reset = (mins: number) => { setRunning(false); startedAt.current = null; elapsedBefore.current = 0; setTarget(mins); setRemaining(mins * 60); };

  const logMinutes = async () => {
    const mins = elapsedMinutes();
    if (mins >= 1) {
      await postTime(date, CATEGORY_FOR_ENERGY[task.energy_tag] ?? 'deep_work', mins, task.title);
      setLogged(mins);
    }
    return mins;
  };

  const finish = async () => { await logMinutes(); await updateTask(task.id, { status: 'completed', date }); onDone(); };
  const stopAndLog = async () => { pause(); await logMinutes(); onDone(); };
  const stuck = async () => { pause(); await logMinutes(); onStuck(); };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  const finished = remaining <= 0;

  return (
    <div className="card focus-card">
      <div className="close-head">
        <div className="card-title" style={{ marginBottom: 0 }}>🎯 Focus · {task.title}</div>
        <button className="habit-delete" onClick={onClose} aria-label="Close focus">✕</button>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        <div className="setup-step">First tiny move</div>
        <input className="input" value={firstMove} onChange={(e) => setFirstMove(e.target.value)} />
        <div className={`timer-face ${finished ? 'done' : ''}`}>{finished ? 'Done ✓' : `${mm}:${ss}`}</div>
        <div className="timer-row">
          {PRESETS.map((p) => <button key={p} className={`btn-xs ${target === p ? 'blue' : ''}`} disabled={running} onClick={() => reset(p)}>{p === 10 ? 'Just 10' : p + 'm'}</button>)}
        </div>
        <div className="timer-row">
          {!running && !finished && <button className="btn-sm green" onClick={start}>▶ {elapsedBefore.current > 0 ? 'Resume' : 'Start'}</button>}
          {running && <button className="btn-sm orange" onClick={pause}>❚❚ Pause</button>}
          <button className="btn-sm green" onClick={finish}>✓ Task done</button>
          <button className="btn-sm blue" onClick={stopAndLog}>■ Stop & log</button>
          <button className="btn-sm orange" onClick={stuck}>⚠ Stuck</button>
        </div>
        <p className="muted">{logged != null ? `Logged ${logged} minutes.` : 'Stopping when the timer ends still counts as a win. Minutes are logged automatically.'}</p>
      </div>
    </div>
  );
}
