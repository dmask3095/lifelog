import { useCallback, useEffect, useState } from 'react';
import { createHabit, deleteHabit, getHabitLog, logHabit } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { getMvd, MVD_EVENT } from '../lib/mvd';
import type { HabitTier, HabitWithStreak } from '../types';

interface Props { date: string; onChanged: () => void; }

const SUGGESTED: Array<{ name: string; icon: string; floor: string; target: string; stretch: string }> = [
  { name: 'Morning walk', icon: '🚶', floor: '5 min outside', target: '20 min walk', stretch: '45 min + sun' },
  { name: 'Meditation', icon: '🧘', floor: '3 breaths', target: '10 min sit', stretch: '20 min' },
  { name: 'Reading', icon: '📖', floor: '2 pages', target: '20 min', stretch: '1 chapter' },
  { name: 'Exercise', icon: '💪', floor: '10 squats', target: '30 min session', stretch: '60 min' },
  { name: 'No phone before 10am', icon: '📵', floor: 'Not in bed', target: 'Until 10am', stretch: 'Until noon' },
  { name: 'Water 2L', icon: '💧', floor: '1 glass on waking', target: '2L', stretch: '3L' },
];

const TIERS: Array<{ tier: HabitTier; label: string; fallback: string }> = [
  { tier: 'bronze', label: 'Bronze', fallback: '2-min floor' },
  { tier: 'silver', label: 'Silver', fallback: 'Standard' },
  { tier: 'gold', label: 'Gold', fallback: 'Stretch' },
];

export default function HabitPanel({ date, onChanged }: Props) {
  const { tick } = useRefresh();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [form, setForm] = useState({ icon: '', name: '', floor: '', target: '', stretch: '' });
  const [mvd, setMvdState] = useState(() => getMvd(date, false));

  useEffect(() => {
    setMvdState(getMvd(date, false));
    const onEvt = () => setMvdState(getMvd(date, false));
    window.addEventListener(MVD_EVENT, onEvt);
    return () => window.removeEventListener(MVD_EVENT, onEvt);
  }, [date]);

  const load = useCallback(() => getHabitLog(date).then((r) => setHabits(r.data)).catch(() => setHabits([])), [date]);
  useEffect(() => { load(); }, [load, tick]);

  const setTier = async (h: HabitWithStreak, tier: HabitTier) => {
    const turnOff = h.completed && h.tier === tier;
    await logHabit(h.id, date, !turnOff, tier);
    await load();
    onChanged();
  };

  const add = async (data: { name: string; icon: string; floor: string; target: string; stretch: string }) => {
    if (!data.name.trim()) return;
    await createHabit({ name: data.name.trim(), icon: data.icon || '✓', floor_label: data.floor || undefined, target_label: data.target || undefined, stretch_label: data.stretch || undefined });
    setForm({ icon: '', name: '', floor: '', target: '', stretch: '' });
    setShowAdd(false);
    setShowSuggestions(false);
    await load();
    onChanged();
  };

  const remove = async (id: number) => { await deleteHabit(id); await load(); onChanged(); };

  const kept = habits.filter((h) => h.completed).length;
  const avgConsistency = habits.length ? Math.round(habits.reduce((a, h) => a + h.consistency14, 0) / habits.length) : 0;
  const alreadyAdded = (name: string) => habits.some((h) => h.name === name);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Habits</h2>
        {habits.length > 0 && kept === habits.length && <div className="streak-badge">🔥 All kept</div>}
      </div>

      {habits.length > 0 && (
        <div className="stat-grid">
          <div className="stat"><div className="stat-val">{kept}<small style={{ fontSize: 12, color: '#6f829a' }}>/{habits.length}</small></div><div className="stat-lab">kept today</div></div>
          <div className="stat"><div className="stat-val">{avgConsistency}%</div><div className="stat-lab">14-day consistency</div></div>
          <div className="stat"><div className="stat-val">{Math.max(0, ...habits.map((h) => h.currentStreak))}</div><div className="stat-lab">longest live streak</div></div>
        </div>
      )}

      {mvd && <div className="mvd-banner"><span>🌿 Minimum Viable Day: bronze counts in full today. Hit the floor, keep the streak.</span></div>}

      {habits.length === 0 && !showAdd && !showSuggestions && (
        <p className="empty" style={{ padding: '20px 0' }}>No habits yet. Add one below; every habit gets a 2-minute bronze floor so bad days never break a streak.</p>
      )}

      {habits.map((h) => (
        <div key={h.id} className={`habit-v2 ${h.completed ? 'kept' : ''}`}>
          <div className="habit-head">
            <div className="habit-name"><span className="icon">{h.icon}</span>{h.name}</div>
            <div className="habit-stats">
              <span title="Current streak">🔥 {h.currentStreak}</span>
              <span className="shield" title="Grace shields: a missed day uses one instead of resetting">🛡 {h.shields}</span>
            </div>
          </div>
          <div className="tier-row">
            {TIERS.map((t) => {
              const label = t.tier === 'bronze' ? h.floor_label : t.tier === 'silver' ? h.target_label : h.stretch_label;
              return (
                <button key={t.tier} type="button" className={`tier-btn ${t.tier} ${h.completed && h.tier === t.tier ? 'active' : ''}`} onClick={() => setTier(h, t.tier)}>
                  <b>{t.label}</b>
                  <small>{label || t.fallback}</small>
                </button>
              );
            })}
          </div>
          <div className="dots" title="Last 14 days">
            {h.history14.map((d) => (
              <span key={d.date} className={`dot ${d.tier ?? ''} ${d.date === date && !d.tier ? 'today-pending' : ''}`} title={`${d.date}: ${d.tier ?? 'missed'}`} />
            ))}
          </div>
          <div className="habit-foot">
            <span>{h.consistency14}% over 14 days · best {h.longestStreak}</span>
            <button className="habit-delete" aria-label={`Delete habit ${h.name}`} onClick={() => remove(h.id)}>✕</button>
          </div>
        </div>
      ))}

      {showSuggestions && (
        <div className="card">
          <div className="card-title">💡 Quick add</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            {SUGGESTED.map((s) => (
              <button key={s.name} onClick={() => add(s)} disabled={alreadyAdded(s.name)} className="hurdle-row" style={{ border: 'none', cursor: alreadyAdded(s.name) ? 'default' : 'pointer', font: 'inherit', textAlign: 'left', opacity: alreadyAdded(s.name) ? 0.4 : 1 }}>
                <span>{s.icon} {s.name}</span>
                <small style={{ color: '#6f829a' }}>{s.floor} → {s.target}</small>
              </button>
            ))}
            <button onClick={() => setShowSuggestions(false)} className="btn-sm">Close</button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="card">
          <div className="card-title">➕ Custom habit</div>
          <div className="form-stack" style={{ position: 'relative' }}>
            <div className="form-grid">
              <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="input" style={{ textAlign: 'center', fontSize: 20 }} placeholder="🎯" maxLength={2} />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Habit name" />
            </div>
            <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className="input" placeholder="Bronze floor (the 2-minute version)" />
            <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="input" placeholder="Silver target (normal day)" />
            <input value={form.stretch} onChange={(e) => setForm({ ...form, stretch: e.target.value })} className="input" placeholder="Gold stretch (optional)" />
            <button onClick={() => add(form)} className="btn-primary" disabled={!form.name.trim()}>Add habit</button>
            <button onClick={() => setShowAdd(false)} className="btn-sm">Cancel</button>
          </div>
        </div>
      )}

      {!showAdd && !showSuggestions && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowSuggestions(true)} className="btn-sm" style={{ flex: 1, borderStyle: 'dashed' }}>💡 Suggestions</button>
          <button onClick={() => setShowAdd(true)} className="btn-sm" style={{ flex: 1, borderStyle: 'dashed' }}>✏️ Custom</button>
        </div>
      )}
    </div>
  );
}
