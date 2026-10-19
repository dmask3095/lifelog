import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Flame, Lightbulb, LoaderCircle, PencilLine, Shield, Trash2, X } from 'lucide-react';
import { createHabit, deleteHabit, getHabitLog, logHabit } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { getMvd, MVD_EVENT } from '../lib/mvd';
import { applyHabitState, createSubmitGuard, describeError, nextHabitState, normalizeTitle } from '../lib/capture';
import type { HabitTier, HabitWithStreak } from '../types';

interface Props { date: string; onChanged: () => void; }

type HabitDraft = { name: string; icon: string; floor: string; target: string; stretch: string };
type Wanted = { completed: boolean; tier: HabitTier };

const SUGGESTED: Array<HabitDraft> = [
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
const HIT = { minHeight: 40, minWidth: 40 } as const;
const EMPTY_FORM: HabitDraft = { icon: '', name: '', floor: '', target: '', stretch: '' };

export default function HabitPanel({ date, onChanged }: Props) {
  const { tick } = useRefresh();
  const [habits, setHabits] = useState<HabitWithStreak[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [form, setForm] = useState<HabitDraft>(EMPTY_FORM);
  const [formHint, setFormHint] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [mvd, setMvdState] = useState(() => getMvd(date, false));
  const nameRef = useRef<HTMLInputElement | null>(null);
  const guardRef = useRef(createSubmitGuard());
  // Latest-wins check-in queue per habit: taps apply instantly; requests are sent in order and
  // only the newest wanted state is guaranteed to reach the server.
  const wanted = useRef(new Map<number, Wanted>());
  const sending = useRef(new Set<number>());
  const dateRef = useRef(date);
  const onChangedRef = useRef(onChanged);
  useEffect(() => { dateRef.current = date; onChangedRef.current = onChanged; });

  useEffect(() => {
    setMvdState(getMvd(date, false));
    const onEvt = () => setMvdState(getMvd(date, false));
    window.addEventListener(MVD_EVENT, onEvt);
    return () => window.removeEventListener(MVD_EVENT, onEvt);
  }, [date]);

  const load = useCallback(async () => {
    const d = dateRef.current;
    const r = await getHabitLog(d);
    if (dateRef.current !== d) return;
    // Do not overwrite optimistic rows that still have an unsent/in-flight check-in.
    setHabits((cur) => r.data.map((h) => {
      if (!wanted.current.has(h.id) && !sending.current.has(h.id)) return h;
      return cur.find((c) => c.id === h.id) ?? h;
    }));
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load, date, tick]);

  const flush = async (id: number, d: string) => {
    if (sending.current.has(id)) return;
    sending.current.add(id);
    let sent: Wanted | undefined;
    try {
      let next = wanted.current.get(id);
      while (next && next !== sent) {
        sent = next;
        await logHabit(id, d, next.completed, next.tier);
        next = wanted.current.get(id);
      }
      wanted.current.delete(id);
    } catch (err) {
      wanted.current.delete(id);
      setError(describeError(err, 'Couldn’t save that check-in'));
    } finally {
      sending.current.delete(id);
    }
    await load().catch(() => {});
    onChangedRef.current();
  };

  const setTier = (h: HabitWithStreak, tier: HabitTier) => {
    setError('');
    const next = nextHabitState(h, tier);
    setHabits((hs) => applyHabitState(hs, h.id, next, date));
    // The API needs a tier even when un-checking; send the tapped one.
    wanted.current.set(h.id, { completed: next.completed, tier });
    void flush(h.id, date);
  };

  const add = async (data: HabitDraft, source: 'form' | 'suggestion') => {
    const name = normalizeTitle(data.name);
    if (!name) {
      setFormHint('Give the habit a name first.');
      nameRef.current?.focus();
      return;
    }
    const key = name.toLowerCase();
    if (guardRef.current.begin(key) !== 'ok') return; // lagged double tap
    setFormHint('');
    setError('');
    setAdding(name);
    try {
      await createHabit({ name, icon: data.icon || '✓', floor_label: data.floor || undefined, target_label: data.target || undefined, stretch_label: data.stretch || undefined });
      if (source === 'form') { setForm(EMPTY_FORM); setShowAdd(false); }
      await load().catch(() => {});
      onChanged();
    } catch (err) {
      setError(describeError(err, `Couldn’t add “${name}”`));
      guardRef.current.reset(key);
    } finally {
      guardRef.current.end(key);
      setAdding(null);
    }
  };

  const remove = async (id: number) => {
    const key = `delete:${id}`;
    if (guardRef.current.begin(key) !== 'ok') return;
    setConfirmDelete(null);
    setError('');
    setHabits((hs) => hs.filter((h) => h.id !== id));
    try {
      await deleteHabit(id);
      onChanged();
    } catch (err) {
      setError(describeError(err, 'Couldn’t delete that habit'));
      guardRef.current.reset(key);
    } finally {
      guardRef.current.end(key);
      await load().catch(() => {});
    }
  };

  const onSubmitForm = (e: FormEvent) => { e.preventDefault(); void add(form, 'form'); };

  const kept = habits.filter((h) => h.completed).length;
  const avgConsistency = habits.length ? Math.round(habits.reduce((a, h) => a + h.consistency14, 0) / habits.length) : 0;
  const alreadyAdded = (name: string) => habits.some((h) => h.name === name);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Habits</h2>
        {habits.length > 0 && kept === habits.length && <div className="streak-badge"><Flame size={14} aria-hidden="true" /> All kept</div>}
      </div>

      {habits.length > 0 && (
        <div className="stat-grid">
          <div className="stat"><div className="stat-val">{kept}<small className="stat-of" style={{ fontSize: 12 }}>/{habits.length}</small></div><div className="stat-lab">kept today</div></div>
          <div className="stat"><div className="stat-val">{avgConsistency}%</div><div className="stat-lab">14-day consistency</div></div>
          <div className="stat"><div className="stat-val">{Math.max(0, ...habits.map((h) => h.currentStreak))}</div><div className="stat-lab">longest live streak</div></div>
        </div>
      )}

      {mvd && <div className="mvd-banner"><span>Minimum Viable Day: bronze counts in full today. Hit the floor, keep the streak.</span></div>}

      {error && (
        <div className="capture-error-banner" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span><CircleAlert size={14} aria-hidden="true" /> {error}</span>
          <button type="button" className="btn-xs" style={HIT} aria-label="Dismiss error" onClick={() => setError('')}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {habits.length === 0 && !showAdd && !showSuggestions && (
        <p className="empty" style={{ padding: '20px 0' }}>No habits yet. Add one below; every habit gets a 2-minute bronze floor so bad days never break a streak.</p>
      )}

      {habits.map((h) => (
        <div key={h.id} className={`habit-v2 ${h.completed ? 'kept' : ''}`} data-habit-id={h.id}>
          <div className="habit-head">
            <div className="habit-name"><span className="icon">{h.icon}</span>{h.name}</div>
            <div className="habit-stats">
              <span title="Current streak"><Flame size={13} aria-hidden="true" /> {h.currentStreak}</span>
              <span className="shield" title="Grace shields: a missed day uses one instead of resetting"><Shield size={13} aria-hidden="true" /> {h.shields}</span>
            </div>
          </div>
          <div className="tier-row" role="group" aria-label={`${h.name} check-in`}>
            {TIERS.map((t) => {
              const label = t.tier === 'bronze' ? h.floor_label : t.tier === 'silver' ? h.target_label : h.stretch_label;
              const active = h.completed && h.tier === t.tier;
              return (
                <button key={t.tier} type="button" aria-pressed={active} className={`tier-btn ${t.tier} ${active ? 'active' : ''}`} style={{ minHeight: 44 }} onClick={() => setTier(h, t.tier)}>
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
            {confirmDelete === h.id ? (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>Delete?</span>
                <button type="button" className="btn-xs red" style={HIT} onClick={() => remove(h.id)}>Delete</button>
                <button type="button" className="btn-xs" style={HIT} onClick={() => setConfirmDelete(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="habit-delete" style={HIT} aria-label={`Delete habit ${h.name}`} onClick={() => setConfirmDelete(h.id)}><Trash2 size={15} aria-hidden="true" /></button>
            )}
          </div>
        </div>
      ))}

      {showSuggestions && (
        <div className="card">
          <div className="card-title"><Lightbulb size={14} aria-hidden="true" /> Quick add</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            {SUGGESTED.map((s) => {
              const added = alreadyAdded(s.name);
              const isAdding = adding === s.name;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => { if (!added) void add(s, 'suggestion'); }}
                  aria-disabled={added || undefined}
                  className={`hurdle-row suggestion-row ${added ? 'is-added' : ''} ${isAdding ? 'is-saving' : ''}`}
                  style={{ border: 'none', cursor: added ? 'default' : 'pointer', font: 'inherit', textAlign: 'left', minHeight: 40, opacity: added ? 0.5 : 1 }}
                >
                  <span>{s.icon} {s.name}</span>
                  <small className="suggestion-meta">{isAdding ? <><LoaderCircle size={12} className="spin" aria-hidden="true" /> Adding…</> : added ? 'Added' : `${s.floor} → ${s.target}`}</small>
                </button>
              );
            })}
            <button type="button" onClick={() => setShowSuggestions(false)} className="btn-sm" style={{ minHeight: 40 }}>Close</button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="card">
          <div className="card-title"><PencilLine size={14} aria-hidden="true" /> Custom habit</div>
          <form className="form-stack" style={{ position: 'relative' }} onSubmit={onSubmitForm} noValidate>
            <div className="form-grid">
              <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="input" style={{ textAlign: 'center', fontSize: 20, minHeight: 40 }} placeholder="🎯" aria-label="Icon (optional emoji)" maxLength={2} />
              <input ref={nameRef} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (formHint) setFormHint(''); }} className="input" style={{ minHeight: 40 }} placeholder="Habit name" aria-label="Habit name" aria-invalid={formHint ? true : undefined} />
            </div>
            <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className="input" style={{ minHeight: 40 }} placeholder="Bronze floor (the 2-minute version)" />
            <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="input" style={{ minHeight: 40 }} placeholder="Silver target (normal day)" />
            <input value={form.stretch} onChange={(e) => setForm({ ...form, stretch: e.target.value })} className="input" style={{ minHeight: 40 }} placeholder="Gold stretch (optional)" />
            {formHint && <div className="capture-hint" role="status">{formHint}</div>}
            {/* Never disabled: empty submit focuses the name with a hint. */}
            <button type="submit" className="btn-primary" style={{ minHeight: 40 }} aria-busy={adding === normalizeTitle(form.name) || undefined}>
              {adding && adding === normalizeTitle(form.name) ? 'Adding…' : 'Add habit'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setFormHint(''); }} className="btn-sm" style={{ minHeight: 40 }}>Cancel</button>
          </form>
        </div>
      )}

      {!showAdd && !showSuggestions && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setShowSuggestions(true)} className="btn-sm" style={{ flex: 1, borderStyle: 'dashed', minHeight: 40 }}><Lightbulb size={14} aria-hidden="true" /> Suggestions</button>
          <button type="button" onClick={() => setShowAdd(true)} className="btn-sm" style={{ flex: 1, borderStyle: 'dashed', minHeight: 40 }}><PencilLine size={14} aria-hidden="true" /> Custom</button>
        </div>
      )}
    </div>
  );
}
