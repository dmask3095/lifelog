import { useRef, useState, type FormEvent } from 'react';
import { Check, CircleAlert, LoaderCircle, Plus, RotateCw, X } from 'lucide-react';
import { HIGHLIGHT_MS, isFresh, parseQuickTitle } from '../lib/capture';
import { useExpiring, useQuickAdd } from '../lib/useQuickAdd';

export interface QuickAddTaskProps {
  /** YYYY-MM-DD the task is created for. */
  date: string;
  /** Called after the server confirms the create. The shared RefreshContext is bumped too. */
  onAdded?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

const EMPTY_HINT = 'Type a task first, then press Enter or Add.';
const MAX_SAVED_ROWS = 4;

/**
 * Quick add for the Today screen. Real <form>: Enter or the Add button submits. The button is
 * never disabled; an empty submit focuses the field with a hint. The row appears immediately
 * (saving), is highlighted ~2s once confirmed, and shows an inline error with Retry on failure.
 * Inline syntax: trailing "!" = high, "!!" = urgent, "#deep/#admin/#quick/#recovery" energy.
 */
export default function QuickAddTask({ date, onAdded, placeholder = 'Add a task… (Enter)', autoFocus = false }: QuickAddTaskProps) {
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { pending, submit, retry, dismiss } = useQuickAdd({ onAdded });

  const rows = pending.filter((p) => p.date === date);
  const active = rows.filter((p) => p.state !== 'saved');
  const saved = rows.filter((p) => p.state === 'saved').slice(0, MAX_SAVED_ROWS);
  const now = useExpiring(saved.map((p) => (p.savedAt ?? 0) + HIGHLIGHT_MS));
  const visible = [...active, ...saved];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseQuickTitle(title);
    const outcome = submit({ title: parsed.title, date, priority: parsed.priority, energy_tag: parsed.energy_tag });
    if (outcome === 'empty') {
      setHint(EMPTY_HINT);
      inputRef.current?.focus();
      return;
    }
    // 'busy' = the same task is already being saved (lagged double submit): nothing to do.
    setTitle('');
    setHint('');
    inputRef.current?.focus();
  };

  return (
    <div className="quick-add-wrap">
      <form className="quick-add" onSubmit={onSubmit} noValidate>
        <input
          ref={inputRef}
          className="input quick-add-input"
          value={title}
          onChange={(e) => { setTitle(e.target.value); if (hint) setHint(''); }}
          placeholder={placeholder}
          aria-label="New task"
          aria-invalid={hint ? true : undefined}
          aria-describedby={hint ? `quick-add-hint-${date}` : undefined}
          autoFocus={autoFocus}
          enterKeyHint="done"
          style={{ minHeight: 40, flex: 1, minWidth: 0 }}
        />
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
