import { useState } from 'react';
import { api } from '../api';

interface Props { date: string; }

export default function BodyPanel({ date }: Props) {
  const [sleepHours, setSleepHours] = useState(0);
  const [peeCount, setPeeCount] = useState(0);
  const [saved, setSaved] = useState('');

  const logSleep = async () => {
    await api.post('/body-logs', {
      date, type: 'sleep', duration_minutes: sleepHours * 60,
      time: new Date().toTimeString().slice(0, 5),
    });
    setSaved('sleep');
    setTimeout(() => setSaved(''), 2000);
  };

  const logPee = async () => {
    await api.post('/body-logs', {
      date, type: 'pee', time: new Date().toTimeString().slice(0, 5),
    });
    setPeeCount(p => p + 1);
    setSaved('pee');
    setTimeout(() => setSaved(''), 1500);
  };

  return (
    <div className="panel">
      <h2>Body Log</h2>

      <div className="log-section">
        <label>😴 Sleep</label>
        <div className="time-row">
          <button onClick={() => setSleepHours(h => Math.max(0, h - 0.5))} className="btn-sm">−</button>
          <span className="time-amount">{sleepHours} hrs</span>
          <button onClick={() => setSleepHours(h => h + 0.5)} className="btn-sm green">+</button>
        </div>
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
    </div>
  );
}
