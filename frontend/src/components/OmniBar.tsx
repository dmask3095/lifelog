import { useEffect, useRef, useState } from 'react';
import { getJournal, omniLog, saveJournal } from '../api';
import { useRefresh } from '../context/RefreshContext';
import type { OmniPlan } from '../types';
import { fmtMinutes } from '../lib/dates';

interface Props { date: string; }

const EXAMPLES = [
  'Slept 11:30pm to 7am, drank 750ml water, finished the auth PR, 90m deep work, mood 4',
  'Stuck on the OAuth redirect bug, 45m admin emails, had chicken salad and a coffee',
  'Todo: send invoice to Priya !, 30m walk, feeling tired, note: proud I showed up anyway',
];

type SpeechCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void;
};

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function previewChips(plan: OmniPlan): Array<{ icon: string; text: string; tone: string }> {
  const chips: Array<{ icon: string; text: string; tone: string }> = [];
  if (plan.sleep) chips.push({ icon: '😴', text: `Sleep ${plan.sleep.start} → ${plan.sleep.end} · ${fmtMinutes(plan.sleep.minutes)}`, tone: 'sleep' });
  if (plan.waterMl) chips.push({ icon: '💧', text: `+${plan.waterMl} ml water`, tone: 'water' });
  if (plan.mood) chips.push({ icon: '😊', text: `Mood ${plan.mood.score}/5`, tone: 'mood' });
  for (const t of plan.timeLogs) chips.push({ icon: '⏱', text: `${fmtMinutes(t.minutes)} ${t.category.replace('_', ' ')}`, tone: 'time' });
  for (const t of plan.completedTasks) chips.push({ icon: '✅', text: `Done: ${t}`, tone: 'task' });
  for (const h of plan.hurdles) chips.push({ icon: '⚠️', text: `Hurdle: ${h.subject}`, tone: 'hurdle' });
  for (const t of plan.newTasks) chips.push({ icon: '➕', text: `Task: ${t.title} (${t.priority})`, tone: 'task' });
  if (plan.fuel.notes.length) chips.push({ icon: '🍽', text: `Fuel: ${plan.fuel.notes.join('; ')}${plan.fuel.tags.length ? ' · ' + plan.fuel.tags.join(', ') : ''}`, tone: 'fuel' });
  for (const j of plan.journal) chips.push({ icon: '📓', text: `Journal: ${j}`, tone: 'journal' });
  return chips;
}

export default function OmniBar({ date }: Props) {
  const { bump } = useRefresh();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<OmniPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [applied, setApplied] = useState<Array<{ label: string; detail: string }> | null>(null);
  const [keepLeftovers, setKeepLeftovers] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);
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

  // Debounced live preview of what will be written.
  useEffect(() => {
    if (!text.trim()) { setPlan(null); return; }
    const handle = setTimeout(() => {
      omniLog(text, date, false).then((res) => setPlan(res.data.plan)).catch(() => setPlan(null));
    }, 280);
    return () => clearTimeout(handle);
  }, [text, date]);

  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  };

  const commit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await omniLog(text, date, true);
      const leftovers = res.data.plan.unparsed.filter((c) => c.split(/\s+/).length >= 3);
      const appliedItems = [...res.data.applied];
      if (keepLeftovers && leftovers.length > 0) {
        const existing = await getJournal(date);
        const timeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const note = `${timeLabel}\n${leftovers.join('\n')}`;
        const content = existing.data?.content ? `${existing.data.content}\n\n${note}` : note;
        await saveJournal(date, content);
        appliedItems.push({ table: 'journal_entries', label: 'Journal', detail: leftovers.join(' / ') });
      }
      if (appliedItems.length === 0) {
        setError('Nothing recognised yet. Try "slept 11pm to 7am", "750ml water", "finished X", "stuck on Y", "60m deep work", "mood 4".');
      } else {
        setApplied(appliedItems);
        setText('');
        setPlan(null);
        bump();
        setTimeout(() => setApplied(null), 6000);
      }
    } catch {
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
      autoGrow();
    }
  };

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

  return (
    <div className="omni">
      <div className="omni-row">
        <textarea
          ref={inputRef}
          className="omni-input"
          rows={1}
          value={text}
          placeholder="Log your day in one line… sleep, water, tasks, hurdles, time, mood (⌘K)"
          onChange={(e) => { setText(e.target.value); autoGrow(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } }}
        />
        <div className="omni-buttons">
          {canSpeak && (
            <button type="button" className={`omni-mic ${listening ? 'live' : ''}`} onClick={toggleVoice} aria-label={listening ? 'Stop listening' : 'Speak your log'} title="Speak">
              {listening ? '■' : '🎙'}
            </button>
          )}
          <button type="button" className="omni-go" onClick={commit} disabled={busy || !text.trim()}>
            {busy ? '…' : 'Log it'}
          </button>
        </div>
      </div>

      {!text && !applied && (
        <div className="omni-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="omni-example" onClick={() => { setText(ex); setTimeout(autoGrow, 0); inputRef.current?.focus(); }}>
              {ex.length > 46 ? ex.slice(0, 46) + '…' : ex}
            </button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="omni-chips">
          {chips.map((c, i) => (
            <span key={i} className={`chip tone-${c.tone}`}>{c.icon} {c.text}</span>
          ))}
          {leftovers.length > 0 && (
            <label className="chip tone-muted omni-leftover">
              <input type="checkbox" checked={keepLeftovers} onChange={(e) => setKeepLeftovers(e.target.checked)} />
              Journal the rest: “{leftovers.join(' · ').slice(0, 80)}”
            </label>
          )}
        </div>
      )}

      {applied && (
        <div className="omni-chips applied">
          <span className="chip tone-ok">✓ Logged</span>
          {applied.map((a, i) => (
            <span key={i} className="chip tone-ok">{a.label}: {a.detail}</span>
          ))}
        </div>
      )}
      {error && <div className="omni-error">{error}</div>}
    </div>
  );
}
