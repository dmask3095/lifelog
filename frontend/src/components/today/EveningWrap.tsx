import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Flag, Loader2, Moon, Target, X } from 'lucide-react';
import { api } from '../../api';
import { useRefresh } from '../../context/RefreshContext';
import type { SummaryData } from '../../types';
import { dayScore, encouragement, errorText, pickPlan, planApi, planStats, type DayPlan } from './dayPlan';

// Evening wrap: three short steps (what got done, one hurdle, tomorrow's top 1),
// then the day's score with a line of encouragement computed from the numbers.
interface Props {
  date: string;
  tomorrow: string;
  plan: DayPlan | null;
  data: SummaryData | null;
  onClose: () => void;
  onSaved: (plan: DayPlan | null) => void;
}


export default function EveningWrap({ date, plan, data, onClose, onSaved }: Props) {
  const { bump } = useRefresh();
  const existing = plan?.wrap ?? null;
  const [step, setStep] = useState<0 | 1 | 2 | 3>(existing?.savedAt ? 3 : 0);
  const [hurdle, setHurdle] = useState(existing?.hurdle ?? '');
  const [hurdleTaskId, setHurdleTaskId] = useState<number | null>(existing?.hurdleTaskId ?? null);
  const [top, setTop] = useState(existing?.tomorrowTop ?? '');
  const [topTaskId, setTopTaskId] = useState<number | null>(existing?.tomorrowTaskId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const saveGuard = useRef(false);
  const api$ = useMemo(() => planApi(api), []);

  const stats = planStats(plan);
  const openTasks = (data?.tasks.items ?? []).filter((t) => t.status !== 'completed');
  const doneItems = useMemo(() => {
    const out: string[] = [];
    for (const b of plan?.blocks ?? []) if (b.status === 'done') out.push(b.title);
    for (const t of data?.tasks.items ?? []) if (t.status === 'completed' && !out.includes(t.title)) out.push(t.title);
    return out.slice(0, 50).map((t) => t.slice(0, 200));
  }, [plan, data]);
  const habitsKept = data ? `${data.habits.completed}/${data.habits.total}` : null;
  const suggestions = useMemo(() => {
    const ids = new Set<number>();
    const out: Array<{ title: string; taskId?: number }> = [];
    for (const b of plan?.blocks ?? []) {
      if (b.status !== 'done' && b.taskId && b.kind !== 'habit' && !ids.has(b.taskId)) { ids.add(b.taskId); out.push({ title: b.title, taskId: b.taskId }); }
    }
    for (const t of openTasks) if (!ids.has(t.id)) { ids.add(t.id); out.push({ title: t.title, taskId: t.id }); }
    return out.slice(0, 4);
  }, [plan, openTasks]);

  const score = dayScore(plan, data);
  const savedTop = plan?.wrap?.tomorrowTop ?? (top.trim() || null);

  const finish = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saveGuard.current) return;
    saveGuard.current = true;
    setSaving(true);
    setError(null);
    const cleanHurdle = hurdle.trim() || null;
    const cleanTop = top.trim() || null;
    try {
      // One transaction owns the wrap, any selected hurdle and tomorrow's canonical task.
      const res = await api$.patch(date, {
        wrap: { hurdle: cleanHurdle, hurdleTaskId: hurdleTaskId ?? undefined, tomorrowTaskId: topTaskId ?? undefined, tomorrowTop: cleanTop, completed: doneItems, createTomorrowTask: !!cleanTop && !topTaskId && !(cleanTop === existing?.tomorrowTop && !existing?.tomorrowTaskId) },
      });
      onSaved(pickPlan(res.data));
      bump();
      setStep(3);
    } catch (err) {
      setError(errorText(err, 'Couldn’t save the wrap'));
    } finally {
      saveGuard.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="tv-wrap" aria-labelledby="tv-wrap-title">
      <header className="tv-wrap-head">
        <div>
          <p className="tv-eyebrow"><Moon size={13} /> Evening wrap{step < 3 ? ` · step ${step + 1} of 3` : ''}</p>
          <h2 id="tv-wrap-title" className="tv-wrap-title">
            {step === 0 ? 'What got done' : step === 1 ? 'One hurdle worth naming' : step === 2 ? 'Tomorrow’s top 1' : 'Your day, honestly'}
          </h2>
        </div>
        <button type="button" className="tv-btn tv-btn-icon" onClick={onClose} aria-label="Close wrap"><X size={18} /></button>
      </header>
      {step < 3 && (
        <div className="tv-wrap-progress" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'is-on' : ''} />)}</div>
      )}

      {step === 0 && (
        <div className="tv-wrap-body">
          <div className="tv-wrap-stats">
            <div><b>{stats.done}<small>/{stats.total}</small></b><span>plan blocks</span></div>
            <div><b>{data ? data.tasks.completed : '–'}<small>/{data ? data.tasks.total : '–'}</small></b><span>tasks</span></div>
            <div><b>{habitsKept ?? '–'}</b><span>habits</span></div>
            <div><b>{stats.doneMin}<small>m</small></b><span>focused, from the plan</span></div>
          </div>
          {doneItems.length > 0 ? (
            <ul className="tv-mini-list">{doneItems.slice(0, 6).map((t) => <li key={t}><Check size={13} /> {t}</li>)}{doneItems.length > 6 && <li className="tv-muted">+{doneItems.length - 6} more</li>}</ul>
          ) : (
            <p className="tv-muted">Nothing is marked done yet. You can close this, mark blocks done, and come back.</p>
          )}
          <div className="tv-wrap-actions"><button type="button" className="tv-btn tv-btn-primary" onClick={() => setStep(1)}><span>Next</span><ArrowRight size={16} /></button></div>
        </div>
      )}

      {step === 1 && (
        <form className="tv-wrap-body" onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
          <label className="tv-field"><span>What got in the way? (optional)</span>
            <input className="tv-input" value={hurdle} onChange={(e) => setHurdle(e.target.value)} placeholder="e.g. Waiting on design feedback" maxLength={200} autoFocus />
          </label>
          {hurdle.trim() && openTasks.length > 0 && (
            <div className="tv-chip-row" role="group" aria-label="Which task did it block?">
              <span className="tv-move-label"><Flag size={13} /> Blocked task</span>
              {openTasks.slice(0, 5).map((t) => (
                <button key={t.id} type="button" className={`tv-chip ${hurdleTaskId === t.id ? 'is-on' : ''}`} aria-pressed={hurdleTaskId === t.id} onClick={() => setHurdleTaskId(hurdleTaskId === t.id ? null : t.id)}>{t.title}</button>
              ))}
            </div>
          )}
          <div className="tv-wrap-actions">
            <button type="button" className="tv-btn tv-btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button type="submit" className="tv-btn tv-btn-primary"><span>{hurdle.trim() ? 'Next' : 'Skip'}</span><ArrowRight size={16} /></button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form className="tv-wrap-body" onSubmit={(e) => {
          if (!top.trim()) { e.preventDefault(); setHint('Name one thing, or pick a suggestion. You can also finish without it.'); return; }
          void finish(e);
        }}>
          <label className="tv-field"><span>The one thing that would make tomorrow a win</span>
            <input className="tv-input" value={top} onChange={(e) => { setTop(e.target.value); setTopTaskId(null); setHint(null); }} placeholder="e.g. Ship the onboarding copy" maxLength={200} autoFocus />
          </label>
          {suggestions.length > 0 && (
            <div className="tv-chip-row" role="group" aria-label="Suggestions">
              <span className="tv-move-label"><Target size={13} /> Still open</span>
              {suggestions.map((sg) => (
                <button key={sg.title} type="button" className={`tv-chip ${topTaskId === sg.taskId && top === sg.title ? 'is-on' : ''}`} onClick={() => { setTop(sg.title); setTopTaskId(sg.taskId ?? null); setHint(null); }}>{sg.title}</button>
              ))}
            </div>
          )}
          {hint && <p className="tv-hint">{hint}</p>}
          {error && <p className="tv-inline-error" role="alert">{error}</p>}
          <div className="tv-wrap-actions">
            <button type="button" className="tv-btn tv-btn-ghost" onClick={() => setStep(1)}>Back</button>
            {!top.trim() && <button type="button" className="tv-btn tv-btn-quiet" onClick={() => void finish()}>Finish without</button>}
            <button type="submit" className="tv-btn tv-btn-primary">{saving ? <Loader2 className="tv-spin" size={16} /> : <Check size={16} />}<span>Finish wrap</span></button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="tv-wrap-body tv-wrap-result">
          <div className="tv-score">
            <span className="tv-score-value">{score.score ?? '–'}</span>
            <span className="tv-score-label">day score</span>
          </div>
          <div className="tv-score-side">
            {score.parts.length > 0 ? (
              <ul className="tv-score-parts">{score.parts.map((p) => <li key={p.label}><span>{p.label}</span><b>{p.value}%</b><small>{p.detail}</small></li>)}</ul>
            ) : (
              <p className="tv-muted">No plan, tasks or habits today, so there is no score to give.</p>
            )}
            <p className="tv-encourage">{encouragement(plan, data, savedTop)}</p>
            {plan?.wrap?.hurdle && <p className="tv-muted">Hurdle noted: “{plan.wrap.hurdle}”.</p>}
            <div className="tv-wrap-actions">
              <button type="button" className="tv-btn tv-btn-ghost" onClick={() => setStep(1)}>Edit</button>
              <button type="button" className="tv-btn tv-btn-primary" onClick={onClose}><span>Close</span></button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
