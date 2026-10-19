import { useCallback, useEffect, useState } from 'react';
import { archiveExperiment, createExperiment, getExperimentSuggestions, getExperiments, getHabits } from '../api';
import { useRefresh } from '../context/RefreshContext';
import { TIME_CATEGORY_META, type Experiment, type ExperimentCause, type ExperimentEffect, type ExperimentSuggestion, type TimeCategory } from '../types';

interface Props { date: string; }

const VERDICT: Record<Experiment['result']['verdict'], { label: string; cls: string }> = {
  collecting: { label: 'collecting', cls: 'early' },
  supported: { label: 'supported', cls: 'solid' },
  not_supported: { label: 'not supported', cls: 'warn' },
  no_difference: { label: 'no difference', cls: 'early' },
  inconclusive: { label: 'inconclusive', cls: 'warn' },
};

const EFFECTS: Array<{ id: ExperimentEffect; label: string }> = [
  { id: 'mood', label: 'my mood' }, { id: 'productivity', label: 'my task completion' }, { id: 'sleep', label: 'my sleep (next night)' }, { id: 'deep_work', label: 'my deep work' },
];
const TAGS = ['protein', 'produce', 'caffeine', 'sugar', 'alcohol', 'junk'];

// Self-experiments: turn a hunch into a 2-3 week A/B on your own days (Exist's "confirm or
// rule out your hunches"; Brown's Self-E N-of-1 work). Days with the cause vs days without.
export default function ExperimentsCard({ date }: Props) {
  const { tick } = useRefresh();
  const [items, setItems] = useState<Experiment[]>([]);
  const [suggestions, setSuggestions] = useState<ExperimentSuggestion[]>([]);
  const [habits, setHabits] = useState<Array<{ id: number; name: string; icon: string }>>([]);
  const [building, setBuilding] = useState(false);
  const [cause, setCause] = useState<ExperimentCause>('habit');
  const [causeRef, setCauseRef] = useState('');
  const [causeMin, setCauseMin] = useState(30);
  const [effect, setEffect] = useState<ExperimentEffect>('mood');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => Promise.all([getExperiments(date), getExperimentSuggestions(), getHabits()]).then(([e, s, h]) => {
    setItems(e.data);
    setSuggestions(s.data);
    setHabits(h.data);
    if (!causeRef && h.data[0]) setCauseRef(String(h.data[0].id));
  }).catch(() => {}), [date, causeRef]);

  useEffect(() => { load(); }, [load, tick]);

  const start = async (s: { title?: string; cause_kind: string; cause_ref: string; cause_min: number; effect: string; days: number }) => {
    setBusy(true);
    try {
      await createExperiment({ ...s, start_date: date });
      setBuilding(false);
      await load();
    } finally { setBusy(false); }
  };

  const running = items.filter((e) => e.status !== 'archived');
  const used = new Set(running.map((e) => `${e.cause_kind}:${e.cause_ref}:${e.effect}`));

  return (
    <div className="card">
      <div className="card-title">🧫 Experiments</div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {running.length === 0 && <p className="muted">Patterns are hunches. An experiment tests one: pick a cause you control, LifeLog compares the days you did it with the days you didn’t, and tells you honestly.</p>}
        {running.map((e) => {
          const v = VERDICT[e.result.verdict];
          const pct = Math.min(100, Math.round((e.result.daysElapsed / e.result.daysTotal) * 100));
          return (
            <div key={e.id} className="exp-item">
              <div className="insight-title" style={{ fontSize: 14 }}>{e.title}<span className={`badge ${v.cls}`}>{v.label}</span></div>
              <div className="bar-track" style={{ margin: '6px 0' }}><div className="bar-fill" style={{ width: `${pct}%`, background: e.result.verdict === 'supported' ? '#7ce2b6' : e.result.verdict === 'not_supported' ? '#ff9b6b' : '#59c3ff' }} /></div>
              <div className="exp-foot">
                <span className="muted">Day {e.result.daysElapsed} of {e.result.daysTotal} · {e.result.summary}</span>
                <button className="habit-delete" title="Archive" onClick={() => archiveExperiment(e.id).then(load)}>✕</button>
              </div>
            </div>
          );
        })}

        {!building ? (
          <div className="chip-row">
            {suggestions.filter((s) => !used.has(`${s.cause_kind}:${s.cause_ref}:${s.effect}`)).slice(0, 3).map((s) => (
              <button key={s.title} className="chip clickable tone-journal" disabled={busy} onClick={() => start(s)}>🧪 {s.title}</button>
            ))}
            <button className="btn-xs blue" onClick={() => setBuilding(true)}>Custom experiment</button>
          </div>
        ) : (
          <div className="form-stack">
            <div className="muted">When I…</div>
            <div className="chip-row">
              {(['habit', 'time', 'tag'] as ExperimentCause[]).map((c) => (
                <button key={c} className={`energy-chip ${cause === c ? 'active' : ''}`} onClick={() => { setCause(c); setCauseRef(c === 'habit' ? String(habits[0]?.id ?? '') : c === 'time' ? 'deep_work' : 'caffeine'); }}>
                  {c === 'habit' ? 'keep a habit' : c === 'time' ? 'log time on' : 'have a fuel tag'}
                </button>
              ))}
            </div>
            {cause === 'habit' && (
              <select className="select-sm" value={causeRef} onChange={(e) => setCauseRef(e.target.value)}>
                {habits.map((h) => <option key={h.id} value={String(h.id)}>{h.icon} {h.name}</option>)}
              </select>
            )}
            {cause === 'time' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="select-sm" value={causeRef} onChange={(e) => setCauseRef(e.target.value)}>
                  {(Object.keys(TIME_CATEGORY_META) as TimeCategory[]).map((c) => <option key={c} value={c}>{TIME_CATEGORY_META[c].icon} {TIME_CATEGORY_META[c].label}</option>)}
                </select>
                <select className="select-sm" value={causeMin} onChange={(e) => setCauseMin(Number(e.target.value))}>
                  {[15, 30, 60, 90, 120].map((m) => <option key={m} value={m}>{m}m or more</option>)}
                </select>
              </div>
            )}
            {cause === 'tag' && (
              <select className="select-sm" value={causeRef} onChange={(e) => setCauseRef(e.target.value)}>
                {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <div className="muted">…is this better?</div>
            <div className="chip-row">
              {EFFECTS.map((e) => <button key={e.id} className={`energy-chip ${effect === e.id ? 'active' : ''}`} onClick={() => setEffect(e.id)}>{e.label}</button>)}
            </div>
            <div className="chip-row">
              {[14, 21, 28].map((d) => <button key={d} className={`energy-chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} days</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm green" disabled={busy || !causeRef} onClick={() => start({ cause_kind: cause, cause_ref: causeRef, cause_min: cause === 'time' ? causeMin : 0, effect, days })}>Start</button>
              <button className="btn-sm" onClick={() => setBuilding(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
