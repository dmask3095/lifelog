import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Droplet, LoaderCircle, Mic, Moon, NotebookPen, Plus, RotateCw, Smile, Square, Timer, TriangleAlert, Utensils } from 'lucide-react';
import { getJournal, omniLog, saveJournal } from '../api';
import { useRefresh } from '../context/RefreshContext';
import type { OmniPlan } from '../types';
import { fmtMinutes } from '../lib/dates';
import { createSubmitGuard, describeError, normalizeTitle } from '../lib/capture';

interface Props { date: string; }

const EXAMPLES = [
  'Slept 11:30pm to 7am, drank 750ml water, finished the auth PR, 90m deep work, mood 4',
  'Stuck on the OAuth redirect bug, 45m admin emails, had chicken salad and a coffee',
  'Todo: send invoice to Priya !, 30m walk, feeling tired, note: proud I showed up anyway',
];
const EMPTY_HINT = 'Type what happened first, e.g. “slept 11pm to 7am, 750ml water, todo: send invoice”.';
const HIT = { minHeight: 40, minWidth: 40 } as const;

type SpeechCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void;
};

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Chip = { icon: ReactNode; text: string; tone: string };
const I = 13;

function previewChips(plan: OmniPlan): Chip[] {
  const chips: Chip[] = [];
  if (plan.sleep) chips.push({ icon: <Moon size={I} />, text: `Sleep ${plan.sleep.start} → ${plan.sleep.end} · ${fmtMinutes(plan.sleep.minutes)}`, tone: 'sleep' });
  if (plan.waterMl) chips.push({ icon: <Droplet size={I} />, text: `+${plan.waterMl} ml water`, tone: 'water' });
  if (plan.mood) chips.push({ icon: <Smile size={I} />, text: `Mood ${plan.mood.score}/5`, tone: 'mood' });
  for (const t of plan.timeLogs) chips.push({ icon: <Timer size={I} />, text: `${fmtMinutes(t.minutes)} ${t.category.replace('_', ' ')}`, tone: 'time' });
  for (const t of plan.completedTasks) chips.push({ icon: <CircleCheck size={I} />, text: `Done: ${t}`, tone: 'task' });
  for (const h of plan.hurdles) chips.push({ icon: <TriangleAlert size={I} />, text: `Hurdle: ${h.subject}`, tone: 'hurdle' });
  for (const t of plan.newTasks) chips.push({ icon: <Plus size={I} />, text: `Task: ${t.title} (${t.priority})`, tone: 'task' });
  if (plan.fuel.notes.length) chips.push({ icon: <Utensils size={I} />, text: `Fuel: ${plan.fuel.notes.join('; ')}${plan.fuel.tags.length ? ' · ' + plan.fuel.tags.join(', ') : ''}`, tone: 'fuel' });
  for (const j of plan.journal) chips.push({ icon: <NotebookPen size={I} />, text: `Journal: ${j}`, tone: 'journal' });
  return chips;
}

export default function OmniBar({ date }: Props) {
  const { bump } = useRefresh();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<OmniPlan | null>(null);
  // Optimistic state: what is being logged right now (the input is already cleared).
  const [submitting, setSubmitting] = useState<{ text: string; chips: Chip[] } | null>(null);
  const [listening, setListening] = useState(false);
  const [applied, setApplied] = useState<Array<{ label: string; detail: string }> | null>(null);
  const [keepLeftovers, setKeepLeftovers] = useState(true);
  const [error, setError] = useState('');
  const [failedText, setFailedText] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);
  const guardRef = useRef(createSubmitGuard());
  const appliedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSpeak = speechCtor() !== null;

  // Cmd/Ctrl+K focuses the bar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => { if (appliedTimer.current) clearTimeout(appliedTimer.current); }, []);

  // Debounced live preview of what will be written. Stale responses are ignored.
  useEffect(() => {
    if (!text.trim()) { setPlan(null); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      omniLog(text, date, false).then((res) => { if (!cancelled) setPlan(res.data.plan); }).catch(() => { if (!cancelled) setPlan(null); });
    }, 280);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [text, date]);

  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  };

  /** Put text back in the box after a failure, unless the user already typed something new. */
  const restore = (value: string) => {
    setText((cur) => (cur.trim() ? cur : value));
    setTimeout(autoGrow, 0);
  };

  const commit = async (raw: string) => {
    const value = raw.trim();
    const guard = guardRef.current;
    if (!value) {
      if (guard.busy() || guard.recentlyStarted()) return; // lagged duplicate click right after a submit
      setHint(EMPTY_HINT);
      inputRef.current?.focus();
      return;
    }
    const key = `${date}|${normalizeTitle(value).toLowerCase()}`;
    if (guard.busy() || guard.begin(key) !== 'ok') return;

    setHint('');
    setError('');
    setFailedText(null);
    setApplied(null);
    setSubmitting({ text: value, chips: plan ? previewChips(plan) : [] });
    setText('');
    setPlan(null);
    setTimeout(autoGrow, 0);

    try {
      const res = await omniLog(value, date, true);
      const leftovers = res.data.plan.unparsed.filter((c) => c.split(/\s+/).length >= 3);
      const appliedItems = [...res.data.applied];
      if (keepLeftovers && leftovers.length > 0) {
        try {
          const existing = await getJournal(date);
          const timeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const note = `${timeLabel}\n${leftovers.join('\n')}`;
          const content = existing.data?.content ? `${existing.data.content}\n\n${note}` : note;
          await saveJournal(date, content);
          appliedItems.push({ table: 'journal_entries', label: 'Journal', detail: leftovers.join(' / ') });
        } catch (err) {
          if (appliedItems.length > 0) setError(`Logged, but the leftover journal note was not saved: ${describeError(err, 'journal save failed')}`);
          else throw err;
        }
      }
      if (appliedItems.length === 0) {
        restore(value);
        setError('Nothing recognised yet. Try "slept 11pm to 7am", "750ml water", "finished X", "stuck on Y", "60m deep work", "mood 4", "todo: …".');
        guard.reset(key);
      } else {
        setApplied(appliedItems);
        bump();
        if (appliedTimer.current) clearTimeout(appliedTimer.current);
        appliedTimer.current = setTimeout(() => setApplied(null), 6000);
      }
    } catch (err) {
      restore(value);
      setFailedText(value);
      setError(`Not saved. ${describeError(err, 'Could not log that')}`);
      guard.reset(key);
    } finally {
      guard.end(key);
      setSubmitting(null);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void commit(text); };

  const toggleVoice = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript);
      setText((prev) => `${prev ? prev.trim() + ', ' : ''}${parts.join(', ')}`);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const chips = plan ? previewChips(plan) : [];
  const leftovers = plan?.unparsed ?? [];
  const busy = submitting !== null;

  return (
    <form className="omni" onSubmit={onSubmit} noValidate>
      <div className="omni-row">
        <textarea
          ref={inputRef}
          className="omni-input"
          rows={1}
          value={text}
          aria-label="Log your day"
          aria-invalid={hint ? true : undefined}
          placeholder="Log your day in one line… sleep, water, tasks, hurdles, time, mood (⌘K)"
          onChange={(e) => { setText(e.target.value); if (hint) setHint(''); autoGrow(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void commit(text); }
          }}
        />
        <div className="omni-buttons">
          {canSpeak && (
            <button type="button" className={`omni-mic ${listening ? 'live' : ''}`} style={HIT} onClick={toggleVoice} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Speak your log'} title="Speak">
              {listening ? <Square size={16} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
          )}
          {/* Never disabled: a click that lands a frame late must still do something visible. */}
          <button type="submit" className={`omni-go ${busy ? 'is-busy' : ''}`} style={HIT} aria-busy={busy}>
            {busy ? 'Logging…' : 'Log it'}
          </button>
        </div>
      </div>

      {hint && <div className="omni-hint capture-hint" role="status">{hint}</div>}

      {!text && !applied && !submitting && (
        <div className="omni-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="omni-example" style={{ minHeight: 40 }} onClick={() => { setText(ex); setHint(''); setTimeout(autoGrow, 0); inputRef.current?.focus(); }}>
              {ex.length > 46 ? ex.slice(0, 46) + '…' : ex}
            </button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="omni-chips">
          {chips.map((c, i) => (
            <span key={i} className={`chip tone-${c.tone}`}><span className="chip-icon" aria-hidden="true">{c.icon}</span> {c.text}</span>
          ))}
          {leftovers.length > 0 && (
            <label className="chip tone-muted omni-leftover" style={{ minHeight: 40 }}>
              <input type="checkbox" checked={keepLeftovers} onChange={(e) => setKeepLeftovers(e.target.checked)} />
              Journal the rest: “{leftovers.join(' · ').slice(0, 80)}”
            </label>
          )}
        </div>
      )}

      {submitting && (
        <div className="omni-chips pending capture-row is-saving is-fresh" data-state="saving" role="status">
          <span className="chip tone-muted"><LoaderCircle size={I} className="spin" aria-hidden="true" /> Logging “{submitting.text.length > 60 ? submitting.text.slice(0, 60) + '…' : submitting.text}”</span>
          {submitting.chips.map((c, i) => (
            <span key={i} className={`chip tone-${c.tone}`} style={{ opacity: 0.7 }}><span className="chip-icon" aria-hidden="true">{c.icon}</span> {c.text}</span>
          ))}
        </div>
      )}

      {applied && (
        <div className="omni-chips applied capture-row is-saved is-fresh" data-state="saved">
          <span className="chip tone-ok"><CircleCheck size={I} aria-hidden="true" /> Logged</span>
          {applied.map((a, i) => (
            <span key={i} className="chip tone-ok">{a.label}: {a.detail}</span>
          ))}
        </div>
      )}
      {error && (
        <div className="omni-error capture-row is-error" data-state="error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CircleAlert size={14} aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          {failedText && (
            <button type="button" className="btn-xs capture-retry" style={HIT} onClick={() => { const v = text.trim() ? text : failedText; void commit(v); }}>
              <RotateCw size={13} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}
    </form>
  );
}
