import { useState } from 'react';
import { api } from '../api';

interface Props { date: string; }

const MOODS = [
  { score: 1, emoji: '😞', label: 'Rough' },
  { score: 2, emoji: '😕', label: 'Low' },
  { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' },
  { score: 5, emoji: '🤩', label: 'Great' },
];

export default function MoodPanel({ date }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!selected) return;
    await api.post('/moods', { date, score: selected, note });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="log-section">
      <label>😊 How was your day?</label>
      <div className="mood-row">
        {MOODS.map(m => (
          <button key={m.score} className={`mood-btn ${selected === m.score ? 'selected' : ''}`}
            onClick={() => setSelected(m.score)}>
            {m.emoji}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <input value={note} onChange={e => setNote(e.target.value)}
            className="input" placeholder="What made it this way? (optional)" />
          <button onClick={save} className="btn-primary">
            {saved ? '✓ Mood saved!' : 'Save Mood'}
          </button>
        </>
      )}
    </div>
  );
}
