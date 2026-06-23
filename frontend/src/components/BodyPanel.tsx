import { useState, useEffect } from 'react';
import { api } from '../api';

interface Props { date: string; }

interface BodyLog {
  id: number;
  date: string;
  type: 'sleep' | 'pee';
  time: string | null;
  duration_minutes: number | null;
  note: string | null;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sleepDurationMinutes(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return diff <= 0 ? diff + 1440 : diff;
}

function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function BodyPanel({ date }: Props) {
  const [sleepStart, setSleepStart] = useState('23:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [logs, setLogs] = useState<BodyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  const fetchLogs = () => {
    setLoading(true);
    api.get(`/body-logs?date=${date}`)
      .then(res => setLogs(res.data))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, [date]);

  const duration = sleepDurationMinutes(sleepStart, sleepEnd);
  const peeCount = logs.filter(l => l.type === 'pee').length;

  const logSleep = async () => {
    await api.post('/body-logs', {
      date, type: 'sleep', time: sleepStart, duration_minutes: duration,
    });
    setSaved('sleep');
    fetchLogs();
    setTimeout(() => setSaved(''), 2000);
  };

  const logPee = async () => {
    const now = new Date();
    await api.post('/body-logs', {
      date, type: 'pee',
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    });
    setSaved('pee');
    fetchLogs();
    setTimeout(() => setSaved(''), 1500);
  };

  const removeLog = async (id: number) => {
    await api.delete(`/body-logs/${id}`);
    fetchLogs();
  };

  const sortedLogs = [...logs].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  return (
    <div className="panel">
      <div className="log-section">
        <label>😴 Sleep</label>
        <div className="grocery-two-col">
          <div>
            <small>Went to bed</small>
            <input type="time" value={sleepStart} onChange={e => setSleepStart(e.target.value)} className="input" />
          </div>
          <div>
            <small>Woke up</small>
            <input type="time" value={sleepEnd} onChange={e => setSleepEnd(e.target.value)} className="input" />
          </div>
        </div>
        <small style={{ display: 'block', margin: '4px 0 8px' }}>
          {formatClock(sleepStart)} → {formatClock(sleepEnd)} · <strong>{formatDuration(duration)}</strong>
        </small>
        <button onClick={logSleep} className="btn-primary">
          {saved === 'sleep' ? '✓ Logged!' : 'Log Sleep'}
        </button>
      </div>

      <div className="log-section">
        <label>🚽 Bathroom visits today: <strong>{peeCount}</strong></label>
        <button onClick={logPee} className="btn-primary">
          {saved === 'pee' ? '✓ Logged!' : '+ Log Visit'}
        </button>
      </div>

      <div>
        <div className="card-title" style={{ marginBottom: 12 }}>📋 Today's log</div>
        {loading ? (
          <p className="empty">Loading...</p>
        ) : sortedLogs.length === 0 ? (
          <p className="empty">Nothing logged yet today.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedLogs.map(log => (
              <div key={log.id} className="task-card">
                <div className="task-left">
                  <span className="priority-dot" style={{ background: log.type === 'sleep' ? '#aa66ff' : '#4488ff' }} />
                  <span className="task-title">
                    {log.type === 'sleep' && log.time && log.duration_minutes != null
                      ? <>🛏 {formatClock(log.time)} → {formatClock(fromMinutes(toMinutes(log.time) + log.duration_minutes))} · {formatDuration(log.duration_minutes)}</>
                      : <>🚽 {log.time ? formatClock(log.time) : 'Bathroom visit'}</>
                    }
                  </span>
                </div>
                <div className="task-actions">
                  <button className="btn-sm red" onClick={() => removeLog(log.id)} aria-label="Delete log">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
