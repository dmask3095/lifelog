import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props { date: string; }

const categories = [
  { key: 'wasted', label: '⏱ Time Wasted', color: '#ff4444' },
  { key: 'rested', label: '😴 Time Rested', color: '#8844ff' },
  { key: 'cooking', label: '🍳 Cooking Time', color: '#ff8800' },
  { key: 'eating', label: '🍽 Eating Time', color: '#00aa44' },
];

export default function TimePanel({ date }: Props) {
  const [minutes, setMinutes] = useState<Record<string, number>>({
    wasted: 0, rested: 0, cooking: 0, eating: 0,
  });
  const [notes, setNotes] = useState<Record<string, string>>({
    wasted: '', rested: '', cooking: '', eating: '',
  });
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/time-logs?date=${date}`)
      .then(res => {
        const nextMinutes = { wasted: 0, rested: 0, cooking: 0, eating: 0 };
        const nextNotes = { wasted: '', rested: '', cooking: '', eating: '' };

        for (const log of res.data as Array<{ category: keyof typeof nextMinutes; minutes: number; note?: string }>) {
          nextMinutes[log.category] += Number(log.minutes) || 0;
          if (log.note && !nextNotes[log.category]) nextNotes[log.category] = log.note;
        }

        setMinutes(nextMinutes);
        setNotes(nextNotes);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [date]);

  const handleSave = async (category: string) => {
    await api.put('/time-logs/daily', {
      date,
      category,
      minutes: Math.max(0, Number(minutes[category]) || 0),
      note: notes[category],
    });
    setSaved(category);
    setTimeout(() => setSaved(''), 2000);
  };

  return (
    <div className="panel">
      <h2>Time Log</h2>
      {loading && <p style={{ color: '#6f829a', fontSize: 13 }}>Loading your saved timing...</p>}
      {categories.map(cat => (
        <div key={cat.key} className="log-section" style={{ borderLeft: `3px solid ${cat.color}` }}>
          <label>{cat.label}</label>
          <div className="time-row">
            <button onClick={() => setMinutes(m => ({ ...m, [cat.key]: Math.max(0, m[cat.key] - 15) }))} className="btn-sm">−</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <input
                type="number"
                min={0}
                value={minutes[cat.key]}
                onChange={e => setMinutes(m => ({ ...m, [cat.key]: Math.max(0, Number(e.target.value) || 0) }))}
                className="input time-input"
              />
              <span style={{ color: '#a6b8d1', fontSize: 13, fontWeight: 700 }}>min</span>
            </div>
            <button onClick={() => setMinutes(m => ({ ...m, [cat.key]: m[cat.key] + 15 }))} className="btn-sm green">+</button>
          </div>
          <input
            value={notes[cat.key]}
            onChange={e => setNotes(n => ({ ...n, [cat.key]: e.target.value }))}
            placeholder="Note (optional)"
            className="input"
          />
          <button onClick={() => handleSave(cat.key)} className="btn-sm blue">
            {saved === cat.key ? '✓ Saved' : 'Log'}
          </button>
        </div>
      ))}
    </div>
  );
}
