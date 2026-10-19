import { Brain, Check, Clock3, Inbox, Leaf, Loader2, Play, Repeat2, SkipForward, Undo2, Zap, type LucideIcon } from 'lucide-react';
import { elapsedSeconds, formatClock, formatHour, moveOptions, type BlockAction, type PlanBlock } from './dayPlan';

const ENERGY: Record<string, { label: string; Icon: LucideIcon }> = {
  deep: { label: 'Deep', Icon: Brain },
  admin: { label: 'Admin', Icon: Inbox },
  quick: { label: 'Quick', Icon: Zap },
  recovery: { label: 'Recovery', Icon: Leaf },
  habit: { label: 'Habit', Icon: Repeat2 },
};

interface Props {
  block: PlanBlock;
  now: number;
  nowHour: number | null;
  pending: BlockAction | null;
  error: string | null;
  moveOpen: boolean;
  onToggleMove: () => void;
  onAction: (block: PlanBlock, action: BlockAction, startHour?: number) => void;
  isNext: boolean;
}

export default function PlanBlockRow({ block, now, nowHour, pending, error, moveOpen, onToggleMove, onAction, isNext }: Props) {
  const meta = ENERGY[block.energy] ?? ENERGY.quick;
  const active = block.status === 'active';
  const done = block.status === 'done';
  const skipped = block.status === 'skipped';
  const elapsed = active ? elapsedSeconds(block, now) : 0;
  const target = block.minutes * 60;
  const pct = active ? Math.min(100, (elapsed / Math.max(60, target)) * 100) : 0;
  const over = active && elapsed >= target;
  const options = moveOptions(nowHour ?? block.start, block);
  const sub = block.items && block.items.length > 0 ? block.items.map((i) => i.title).join(' · ') : block.reason;
  const busy = (a: BlockAction) => pending === a;
  const tierLabel = block.tier ? block.tier === 'bronze' ? 'floor' : block.tier === 'gold' ? 'stretch' : 'target' : null;

  return (
    <li className={`tv-block tv-e-${block.energy} is-${block.status} ${isNext ? 'is-next' : ''}`} aria-busy={pending ? true : undefined}>
      <div className="tv-block-time">
        <span className="tv-block-start">{formatHour(block.start)}</span>
        <span className="tv-block-len">{block.minutes}m</span>
      </div>
      <span className="tv-block-icon" title={meta.label}><meta.Icon size={16} strokeWidth={2} aria-hidden /></span>
      <div className="tv-block-main">
        <div className="tv-block-title">
          <span className="tv-block-energy">{meta.label}{tierLabel ? ` · ${tierLabel}` : ''}</span>
          <span className="tv-block-name">{block.title}</span>
        </div>
        {active ? (
          <div className="tv-timer" role="timer" aria-live="off">
            <span className={`tv-timer-clock ${over ? 'is-over' : ''}`}>{formatClock(elapsed)}</span>
            <span className="tv-timer-target">/ {block.minutes}:00</span>
            <span className="tv-timer-bar"><span style={{ width: `${pct}%` }} /></span>
            {over && <span className="tv-timer-note">Time’s up. Mark it done to log it.</span>}
          </div>
        ) : done ? (
          <div className="tv-block-sub">{block.loggedMinutes ? `Done · ${block.loggedMinutes} min logged` : 'Done'}</div>
        ) : skipped ? (
          <div className="tv-block-sub">Skipped · carries to tomorrow without penalty</div>
        ) : sub ? (
          <div className="tv-block-sub">{sub}</div>
        ) : null}
        {moveOpen && !done && (
          <div className="tv-move" role="group" aria-label={`Move ${block.title}`}>
            <span className="tv-move-label">Move to</span>
            {options.length === 0 && <span className="tv-move-label">No later slot before 22:00 today.</span>}
            {options.map((h) => (
              <button key={h} type="button" className="tv-chip" onClick={() => onAction(block, 'move', h)}>{formatHour(h)}</button>
            ))}
          </div>
        )}
        {error && <div className="tv-inline-error" role="alert">{error}</div>}
      </div>

      <div className="tv-block-actions">
        {done ? (
          <span className="tv-done-mark" aria-label="Done"><Check size={18} strokeWidth={2.4} /></span>
        ) : skipped ? (
          <button type="button" className="tv-btn tv-btn-ghost" onClick={() => { const back = nowHour == null || block.start > nowHour ? block.start : options[0]; if (back != null) onAction(block, 'move', back); else onToggleMove(); }}>
            {busy('move') ? <Loader2 className="tv-spin" size={16} /> : <Undo2 size={16} />}<span>Bring back</span>
          </button>
        ) : (
          <>
            {!active && (
              <button type="button" className="tv-btn tv-btn-primary" onClick={() => onAction(block, 'start')}>
                {busy('start') ? <Loader2 className="tv-spin" size={16} /> : <Play size={16} />}<span>Start</span>
              </button>
            )}
            <button type="button" className={`tv-btn ${active ? 'tv-btn-primary' : 'tv-btn-quiet'}`} onClick={() => onAction(block, 'done')} aria-label={`Mark ${block.title} done`}>
              {busy('done') ? <Loader2 className="tv-spin" size={16} /> : <Check size={16} />}<span className={active ? '' : 'tv-btn-label-wide'}>Done</span>
            </button>
            <button type="button" className={`tv-btn tv-btn-icon ${moveOpen ? 'is-on' : ''}`} onClick={onToggleMove} aria-label={`Move ${block.title}`} aria-expanded={moveOpen} title="Move">
              {busy('move') ? <Loader2 className="tv-spin" size={16} /> : <Clock3 size={16} />}
            </button>
            <button type="button" className="tv-btn tv-btn-icon" onClick={() => onAction(block, 'skip')} aria-label={`Skip ${block.title}`} title="Skip">
              {busy('skip') ? <Loader2 className="tv-spin" size={16} /> : <SkipForward size={16} />}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
