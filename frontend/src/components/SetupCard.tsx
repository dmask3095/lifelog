import { useState } from 'react';
import { api, createHabit, createTask, saveMood } from '../api';
import { useRefresh } from '../context/RefreshContext';

interface Props { date: string; userId: number; onDone: () => void; }

const SLEEP_OPTIONS = [5, 6, 7, 8, 9];
const MOODS = [
  { score: 1, emoji: '😞', label: 'Rough' }, { score: 2, emoji: '😕', label: 'Low' }, { score: 3, emoji: '😐', label: 'Okay' },
  { score: 4, emoji: '😊', label: 'Good' }, { score: 5, emoji: '🤩', label: 'Great' },
];
const HABITS = [
  { name: 'Morning walk', icon: '🚶', floor: '5 min outside', target: '20 min walk' },
  { name: 'Water 2L', icon: '💧', floor: '1 glass on waking', target: '2L' },
  { name: 'Reading', icon: '📖', floor: '2 pages', target: '20 min' },
  { name: 'Meditation', icon: '🧘', floor: '3 breaths', target: '10 min sit' },
  { name: 'Exercise', icon: '💪', floor: '10 squats', target: '30 min session' },
  { name: 'No phone before 10am', icon: '📵', floor: 'Not in bed', target: 'Until 10am' },
];

export function setupKey(userId: number) { return `lifelog.setup.${userId}`; }

function clock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

// The first session, built around one rule: give something real back in under a minute.
// Step 1 produces a capacity score from two taps. Steps 2 and 3 are optional.
export default function SetupCard({ date, userId, onDone }: Props) {
  const { bump } = useRefresh();
  const [sleep, setSleep] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [oneThing, setOneThing] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSignals, setSavedSignals] = useState(false);

  const capacity = sleep != null || mood != null
    ? Math.round(((sleep != null ? Math.min(100, (sleep * 60 / 450) * 100) * 0.45 : 0) + (mood != null ? mood * 20 * 0.35 : 0)) / ((sleep != null ? 0.45 : 0) + (mood != null ? 0.35 : 0)))
    : null;
  const level = capacity == null ? null : capacity < 65 ? 'recovery' : capacity < 85 ? 'steady' : 'peak';

  const saveSignals = async () => {
    if (sleep == null && mood == null) return;
    setSaving(true);
    try {
      if (sleep != null) await api.post('/body-logs', { date, type: 'sleep', time: clock(7 * 60 - sleep * 60), duration_minutes: sleep * 60 });
      if (mood != null) await saveMood(date, mood, '');
      setSavedSignals(true);
      bump();
    } finally { setSaving(false); }
  };

  const finish = async () => {
    setSaving(true);
    try {
      if (!savedSignals) await saveSignals();
      for (const name of picked) {
        const h = HABITS.find((x) => x.name === name);
        if (h) await createHabit({ name: h.name, icon: h.icon, floor_label: h.floor, target_label: h.target });
      }
      if (oneThing.trim()) await createTask({ title: oneThing.trim(), priority: 'high', date, energy_tag: 'deep' });
      try { localStorage.setItem(setupKey(userId), '1'); } catch { /* ignore */ }
      bump();
      onDone();
    } finally { setSaving(false); }
  };

  const skip = () => { try { localStorage.setItem(setupKey(userId), '1'); } catch { /* ignore */ } onDone(); };

  return (
    <div className="card setup-card">
      <div className="card-title">👋 Sixty seconds to your first signal</div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="setup-step">1 · How did you sleep, and how is today feeling?</div>
          <div className="pill-row" style={{ marginBottom: 8 }}>
            {SLEEP_OPTIONS.map((h) => (
              <button key={h} className={`pill ${sleep === h ? '' : 'ghost'}`} onClick={() => setSleep(h)}>{h}h{h === 9 ? '+' : ''}</button>
            ))}
          </div>
          <div className="mood-row">
            {MOODS.map((m) => (
              <button key={m.score} className={`mood-btn ${mood === m.score ? 'selected' : ''}`} onClick={() => setMood(m.score)}>{m.emoji}<span>{m.label}</span></button>
            ))}
          </div>
          {capacity != null && (
            <div className={`setup-aha ${level}`}>
              <strong>Capacity today: {capacity}% · {level}</strong>
              <span>{level === 'recovery' ? 'LifeLog will suggest a Minimum Viable Day: two must-dos, bronze habits, early night.' : level === 'steady' ? 'A normal day. Protect one deep-work block.' : 'Full tank. Put the hardest thing first.'}</span>
              {!savedSignals && <button className="btn-xs green" onClick={saveSignals} disabled={saving}>Save these</button>}
              {savedSignals && <span className="saved-note">✓ saved</span>}
            </div>
          )}
        </div>

        <div>
          <div className="setup-step">2 · Pick up to 3 habits (each has a 2-minute bronze floor, so bad days never break a streak)</div>
          <div className="pill-row">
            {HABITS.map((h) => {
              const on = picked.includes(h.name);
              return (
                <button key={h.name} className={`tag-chip ${on ? 'active' : ''}`} disabled={!on && picked.length >= 3} onClick={() => setPicked(on ? picked.filter((x) => x !== h.name) : [...picked, h.name])}>
                  {h.icon} {h.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="setup-step">3 · The one thing that would make today a win</div>
          <input className="input" value={oneThing} onChange={(e) => setOneThing(e.target.value)} placeholder="e.g. Send the draft to Priya" onKeyDown={(e) => e.key === 'Enter' && finish()} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={finish} disabled={saving}>{saving ? 'Saving…' : 'Start my day'}</button>
          <button className="btn-sm" onClick={skip}>Skip</button>
        </div>
        <p className="muted">From tomorrow, one line in the bar at the top is enough: “slept 11 to 7, 2 glasses of water, finished the deck, mood 4”.</p>
      </div>
    </div>
  );
}
