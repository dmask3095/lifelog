import { useCallback, useEffect, useRef, useState } from 'react';
import { getTimeLogs, postTime, putDailyTime } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { fmtMinutes } from '../lib/dates';
import { TIME_CATEGORY_META, type TimeCategory } from '../types';

interface Props { date: string; onChanged: () => void; }

const CATEGORIES = Object.keys(TIME_CATEGORY_META) as TimeCategory[];
const PRESETS = [25, 50, 90];

export default function TimePanel({ date, onChanged }: Props) {
  const { tick } = useRefresh();
  const [minutes, setMinutes] = useState<Record<TimeCategory, number>>(() => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<TimeCategory, number>);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<string>('');
  const timers = useRef<Partial<Record<TimeCategory, number>>>({});

  // focus timer
  const [focusCat, setFocusCat] = useState<TimeCategory>('deep_work');
  const [target, setTarget] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const elapsedBefore = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    return getTimeLogs(date).then((r) => {
      const next = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<TimeCategory, number>;
      for (const log of r.data) if (log.category in next) next[log.category] += Number(log.minutes) || 0;
      setMinutes(next);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load, tick]);

  const bump = (cat: TimeCategory, delta: number) => {
    const next = Math.max(0, (minutes[cat] ?? 0) + delta);
    setMinutes((m) => ({ ...m, [cat]: next }));
    window.clearTimeout(timers.current[cat]);
    timers.current[cat] = window.setTimeout(async () => {
      await putDailyTime(date, cat, next);
      setSaved(cat);
      setTimeout(() => setSaved(''), 1200);
      onChanged();
    }, 500);
  };

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const elapsed = elapsedBefore.current + (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      const left = Math.max(0, target * 60 - elapsed);
      setRemaining(left);
      if (left <= 0) {
        setRunning(false);
        void finish(target);
      }
    }, 500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, target]);

  const start = () => { startedAt.current = Date.now(); setRunning(true); };
  const pause = () => {
    if (startedAt.current) elapsedBefore.current += (Date.now() - startedAt.current) / 1000;
    startedAt.current = null;
    setRunning(false);
  };
  const reset = (mins = target) => { setRunning(false); startedAt.current = null; elapsedBefore.current = 0; setTarget(mins); setRemaining(mins * 60); };
  const finish = async (mins: number) => {
    const elapsedMin = Math.max(1, Math.round(mins));
    await postTime(date, focusCat, elapsedMin, 'Focus timer');
    reset(target);
    await load();
    onChanged();
    setSaved(focusCat);
    setTimeout(() => setSaved(''), 1500);
  };
  const stopAndLog = () => {
    const elapsed = elapsedBefore.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
    const mins = Math.round(elapsed / 60);
    setRunning(false);
    startedAt.current = null;
    elapsedBefore.current = 0;
    if (mins >= 1) void finish(mins); else reset(target);
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  const total = CATEGORIES.reduce((a, c) => a + (minutes[c] ?? 0), 0);

  return (
    <div className="panel">
      <div className="log-section">
        <label>🎯 Focus timer</label>
        <div className="timer-face">{mm}:{ss}</div>
        <div className="timer-row" style={{ marginBottom: 10 }}>
          <select className="select-sm" value={focusCat} onChange={(e) => setFocusCat(e.target.value as TimeCategory)} disabled={running}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{TIME_CATEGORY_META[c].icon} {TIME_CATEGORY_META[c].label}</option>)}
          </select>
          {PRESETS.map((p) => (
            <button key={p} className={`btn-xs ${target === p ? 'blue' : ''}`} disabled={running} onClick={() => reset(p)}>{p}m</button>
          ))}
        </div>
        <div className="timer-row">
          {!running ? <button className="btn-sm green" onClick={start}>▶ Start</button> : <button className="btn-sm orange" onClick={pause}>❚❚ Pause</button>}
          <button className="btn-sm blue" onClick={stopAndLog}>■ Stop & log</button>
          <button className="btn-sm" onClick={() => reset(target)}>↺ Reset</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>Finishing a block logs it automatically under the chosen category.</p>
      </div>

      <div className="log-section">
        <label>⏱ Where the day went {loading ? <small style={{ color: '#6f829a' }}>· loading</small> : <small style={{ color: '#6f829a' }}>· {fmtMinutes(total)} logged</small>}</label>
        <div className="time-grid" style={{ marginTop: 10 }}>
          {CATEGORIES.map((c) => (
            <div key={c} className="time-card" style={{ borderLeft: `3px solid ${TIME_CATEGORY_META[c].color}` }}>
              <div className="time-card-head">
                <span>{TIME_CATEGORY_META[c].icon} {TIME_CATEGORY_META[c].label}</span>
                <b style={{ color: saved === c ? '#84f0c2' : undefined }}>{fmtMinutes(minutes[c] ?? 0)}</b>
              </div>
              <div className="time-card-btns">
                <button onClick={() => bump(c, -15)}>−15</button>
                <button onClick={() => bump(c, 15)}>+15</button>
                <button onClick={() => bump(c, 60)}>+1h</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
