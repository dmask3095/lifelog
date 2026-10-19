import { useCallback, useEffect, useState } from 'react';
import { getLatestMood, saveMood } from '../api';
import { useRefresh } from '../context/RefreshContext';

interface Props { date: string; onChanged: () => void; }

const MOODS = [
  { score: 1, emoji: '😞', label: 'Rough' },
  { score: 2, emoji: '😕', label: 'Low' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' },
  { score: 5, emoji: '🤩', label: 'Great' },
];

export default function MoodPanel({ date, onChanged }: Props) {
  const { tick } = useRefresh();
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [savedScore, setSavedScore] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => getLatestMood(date).then((r) => {
    setSelected(r.data?.score ?? null);
    setSavedScore(r.data?.score ?? null);
    setNote(r.data?.note ?? '');
  }).catch(() => { setSelected(null); setSavedScore(null); setNote(''); }), [date]);

  useEffect(() => { load(); }, [load, tick]);

  const save = async () => {
    if (!selected) return;
    await saveMood(date, selected, note);
    setSavedScore(selected);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onChanged();
  };

  const current = MOODS.find((m) => m.score === savedScore);

  return (
    <div className="log-section">
      <label>😊 How is the day feeling?</label>
      {current && (
        <div className="mood-saved" style={{ margin: '6px 0 4px' }}>
          <span>Logged: {current.emoji} {current.label} ({current.score}/5). Change it any time, it updates in place.</span>
        </div>
      )}
      <div className="mood-row">
        {MOODS.map((m) => (
          <button key={m.score} className={`mood-btn ${selected === m.score ? 'selected' : ''}`} onClick={() => setSelected(m.score)}>
            {m.emoji}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="What made it this way? (optional)" onKeyDown={(e) => e.key === 'Enter' && save()} />
          <button onClick={save} className="btn-primary">{saved ? '✓ Mood saved' : savedScore ? 'Update mood' : 'Save mood'}</button>
        </>
      )}
    </div>
  );
}
