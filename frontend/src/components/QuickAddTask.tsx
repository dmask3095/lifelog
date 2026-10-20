import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleAlert, LoaderCircle, Mic, Plus, RotateCw, Square, X } from 'lucide-react';
import { assembleSpeechTranscript, HIGHLIGHT_MS, isFresh, parseQuickTitle, type SpeechResultItem } from '../lib/capture';
import { useExpiring, useQuickAdd } from '../lib/useQuickAdd';

export interface QuickAddTaskProps {
  /** YYYY-MM-DD the task is created for. */
  date: string;
  /** Called after the server confirms the create. The shared RefreshContext is bumped too. */
  onAdded?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

const EMPTY_HINT = 'Type or speak a task first, then press Enter or Add.';
const MAX_SAVED_ROWS = 4;

type SpeechCtor = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<SpeechResultItem> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void; abort?: () => void;
};

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Quick add for the Today screen, with one-tap voice task capture.
 * Real <form>: Enter, Add, or speaking a task into the mic submits.
 * Spoken phrases like "add task send invoice urgent" or "write spec deep work" automatically
 * set priority and energy tag.
 */
export default function QuickAddTask({ date, onAdded, placeholder = 'Add a task… type or tap mic (Enter)', autoFocus = false }: QuickAddTaskProps) {
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);
  const sessionBaseRef = useRef('');
  const spokenRef = useRef('');
  const latestTitleRef = useRef('');
  const { pending, submit, retry, dismiss } = useQuickAdd({ onAdded });
  const canSpeak = speechCtor() !== null;

  const stopVoice = () => {
    const rec = recRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        if (typeof rec.abort === 'function') rec.abort();
        else rec.stop();
      } catch { /* ignore */ }
      recRef.current = null;
    }
    sessionBaseRef.current = '';
    spokenRef.current = '';
    setListening(false);
  };

  useEffect(() => () => stopVoice(), []);

  const commitTitle = (raw: string) => {
    stopVoice();
    const parsed = parseQuickTitle(raw);
    const outcome = submit({ title: parsed.title, date, priority: parsed.priority, energy_tag: parsed.energy_tag });
    if (outcome === 'empty') {
      setHint(EMPTY_HINT);
      inputRef.current?.focus();
      return;
    }
    latestTitleRef.current = '';
    setTitle('');
    setHint('');
    inputRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commitTitle(latestTitleRef.current || title);
  };

  const toggleVoice = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      const current = (latestTitleRef.current || title).trim();
      stopVoice();
      if (current) commitTitle(current);
      return;
    }
    stopVoice();
    setHint('');
    sessionBaseRef.current = latestTitleRef.current.trim();
    spokenRef.current = '';

    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const { text: assembled, spoken } = assembleSpeechTranscript(sessionBaseRef.current, e.results, 0, ' ');
      spokenRef.current = spoken;
      latestTitleRef.current = assembled;
      setTitle(assembled);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      // Auto-add the task as soon as the user finishes speaking the phrase.
      const captured = (latestTitleRef.current || spokenRef.current).trim();
      if (captured) commitTitle(captured);
    };
    rec.onerror = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const rows = pending.filter((p) => p.date === date);
  const active = rows.filter((p) => p.state !== 'saved');
  const saved = rows.filter((p) => p.state === 'saved').slice(0, MAX_SAVED_ROWS);
  const now = useExpiring(saved.map((p) => (p.savedAt ?? 0) + HIGHLIGHT_MS));
  const visible = [...active, ...saved];

  return (
    <div className="quick-add-wrap">
      <form className="quick-add" onSubmit={onSubmit} noValidate>
        <input
          ref={inputRef}
          className="input quick-add-input"
          value={title}
          onChange={(e) => {
            const val = e.target.value;
            latestTitleRef.current = val;
            setTitle(val);
            if (listening) stopVoice();
            if (hint) setHint('');
          }}
          placeholder={listening ? 'Listening… say your task (e.g. “Call dentist urgent”)' : placeholder}
          aria-label="New task"
          aria-invalid={hint ? true : undefined}
          aria-describedby={hint ? `quick-add-hint-${date}` : undefined}
          autoFocus={autoFocus}
          enterKeyHint="done"
          style={{ minHeight: 40, flex: 1, minWidth: 0 }}
        />
        {canSpeak && (
          <button
            type="button"
            className={`omni-mic task-mic ${listening ? 'live' : ''}`}
            style={{ minHeight: 40, minWidth: 40 }}
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={listening ? 'Stop and add spoken task' : 'Add task by voice'}
            title={listening ? 'Stop and add task' : 'Add task by voice'}
          >
            {listening ? <Square size={15} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
          </button>
        )}
        <button type="submit" className="quick-add-btn" aria-label="Add task" style={{ minHeight: 40, minWidth: 40 }}>
          <Plus size={16} aria-hidden="true" />
          <span>Add</span>
        </button>
      </form>
      {hint && <div id={`quick-add-hint-${date}`} className="quick-add-hint" role="status">{hint}</div>}

      {visible.length > 0 && (
        <ul className="quick-add-list" aria-live="polite">
          {visible.map((p) => {
            const fresh = isFresh(p, now);
            return (
              <li
                key={p.tempId}
                className={`capture-row is-${p.state}${fresh ? ' is-fresh' : ''}`}
                data-state={p.state}
                style={fresh && p.state !== 'error' ? { boxShadow: 'inset 0 0 0 2px var(--accent, #59c3ff)' } : undefined}
              >
                <span className="capture-icon" aria-hidden="true">
                  {p.state === 'saving' && <LoaderCircle size={16} className="spin" />}
                  {p.state === 'saved' && <Check size={16} />}
                  {p.state === 'error' && <CircleAlert size={16} />}
                </span>
                <span className="capture-title">{p.task?.title ?? p.title}</span>
                <span className="capture-status">
                  {p.state === 'saving' ? 'Saving…' : p.state === 'saved' ? 'Added' : p.error}
                </span>
                {p.state === 'error' && (
                  <span className="capture-actions">
                    <button type="button" className="capture-retry" onClick={() => retry(p.tempId)} style={{ minHeight: 40 }}>
                      <RotateCw size={14} aria-hidden="true" /> Retry
                    </button>
                    <button type="button" className="capture-dismiss" aria-label="Dismiss" onClick={() => dismiss(p.tempId)} style={{ minHeight: 40, minWidth: 40 }}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
