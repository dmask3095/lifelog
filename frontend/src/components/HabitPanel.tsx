import { useState, useEffect } from 'react';
import { api } from '../api';

interface Habit { id: number; name: string; icon: string; completed: boolean; }
interface Props { date: string; }

const SUGGESTED = [
  { name: 'Morning walk', icon: '🚶' },
  { name: 'Meditation', icon: '🧘' },
  { name: 'Reading', icon: '📖' },
  { name: 'Exercise', icon: '💪' },
  { name: 'No social media before 10am', icon: '📵' },
];

export default function HabitPanel({ date }: Props) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const fetchHabits = async () => {
    const res = await api.get(`/habits/log/${date}`);
    setHabits(res.data);
  };

  useEffect(() => { fetchHabits(); }, [date]);

  const toggle = async (habit: Habit) => {
    await api.post('/habits/log', {
      habit_id: habit.id, date, completed: !habit.completed,
    });
    fetchHabits();
  };

  const addHabit = async (name: string, icon: string) => {
    if (!name.trim()) return;
    await api.post('/habits', { name, icon: icon || '✓' });
    setNewName('');
    setNewIcon('');
    setShowAdd(false);
    setShowSuggestions(false);
    fetchHabits();
  };

  const removeHabit = async (id: number) => {
    await api.delete(`/habits/${id}`);
    fetchHabits();
  };

  const completed = habits.filter(h => h.completed).length;
  const allDone = habits.length > 0 && completed === habits.length;
  const alreadyAdded = (name: string) => habits.some(h => h.name === name);

  return (
    <div className="panel">

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Habits</h2>
        {allDone && <div className="streak-badge">🔥 All done!</div>}
      </div>

      {/* Progress bar */}
      {habits.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: '#555', marginTop: -8 }}>
            {completed} of {habits.length} completed today
          </div>
          <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: '#00cc88',
              width: `${(completed / habits.length) * 100}%`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </>
      )}

      {/* Habit list — always visible */}
      {habits.length === 0 && !showAdd && !showSuggestions && (
        <p className="empty" style={{ padding: '20px 0' }}>
          No habits yet. Add your first one below.
        </p>
      )}

      {habits.map(habit => (
        <div key={habit.id}
          className={`habit-item ${habit.completed ? 'done' : ''}`}
          onClick={() => toggle(habit)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>{habit.icon}</span>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{habit.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="habit-check">{habit.completed ? '✓' : ''}</div>
            <button
              onClick={e => { e.stopPropagation(); removeHabit(habit.id); }}
              className="tooltip-trigger"
              data-tooltip="Delete this habit. The council has spoken."
              aria-label={`Delete habit ${habit.name}`}
              style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 16, padding: '4px 6px', borderRadius: 6 }}
            >✕</button>
          </div>
        </div>
      ))}

      {/* Suggestions panel */}
      {showSuggestions && (
        <div className="card">
          <div className="card-title">💡 Quick add suggestions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SUGGESTED.map(s => (
              <button key={s.name}
                onClick={() => addHabit(s.name, s.icon)}
                disabled={alreadyAdded(s.name)}
                style={{
                  padding: '13px 16px', background: alreadyAdded(s.name) ? '#111' : '#1a1a1a',
                  border: '1px solid #2a2a2a', borderRadius: 12,
                  color: alreadyAdded(s.name) ? '#333' : '#ccc',
                  cursor: alreadyAdded(s.name) ? 'default' : 'pointer',
                  textAlign: 'left', fontSize: 14,
                  display: 'flex', gap: 10, alignItems: 'center',
                }}>
                <span>{s.icon}</span>
                <span>{s.name}</span>
                {alreadyAdded(s.name) && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#333' }}>Added</span>}
              </button>
            ))}
          </div>
          <button onClick={() => setShowSuggestions(false)}
            style={{ marginTop: 12, padding: 12, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, width: '100%' }}>
            Close
          </button>
        </div>
      )}

      {/* Custom add form */}
      {showAdd && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-title">➕ Custom habit</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newIcon} onChange={e => setNewIcon(e.target.value)}
              className="input" style={{ width: 60, textAlign: 'center', fontSize: 20 }}
              placeholder="🎯" maxLength={2} />
            <input value={newName} onChange={e => setNewName(e.target.value)}
              className="input" placeholder="Habit name..."
              onKeyDown={e => e.key === 'Enter' && addHabit(newName, newIcon)} />
          </div>
          <button onClick={() => addHabit(newName, newIcon)} className="btn-primary"
            disabled={!newName.trim()}>
            Add Habit
          </button>
          <button onClick={() => setShowAdd(false)}
            style={{ padding: 12, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      )}

      {/* Bottom action buttons — always visible */}
      {!showAdd && !showSuggestions && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowSuggestions(true)}
            style={{ flex: 1, padding: '14px', background: '#1a1a1a', border: '1px dashed #2a2a2a', borderRadius: 12, color: '#555', cursor: 'pointer', fontSize: 14 }}>
            💡 Suggestions
          </button>
          <button onClick={() => setShowAdd(true)}
            style={{ flex: 1, padding: '14px', background: '#1a1a1a', border: '1px dashed #2a2a2a', borderRadius: 12, color: '#555', cursor: 'pointer', fontSize: 14 }}>
            ✏️ Custom
          </button>
        </div>
      )}

    </div>
  );
}
