import type { PlanBlock } from './dayPlan';

// The crafted moment: one dial that holds the whole day. The inner arc is capacity;
// the outer track is the day from 6:00 to 22:00 with the productive window, every
// planned block in its real slot, and a marker for now.
const DAY_START = 6;
const DAY_END = 22;
const SWEEP = 270;

const hourToAngle = (h: number) => -SWEEP / 2 + ((Math.min(DAY_END, Math.max(DAY_START, h)) - DAY_START) / (DAY_END - DAY_START)) * SWEEP;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  if (to - from < 0.01) to = from + 0.01;
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

interface Props {
  capacity: number | null;
  known: boolean;
  label: string;
  blocks: PlanBlock[];
  window: { start: number; end: number } | null;
  nowHour: number | null;
  size?: number;
}

export default function CapacityDial({ capacity, known, label, blocks, window: win, nowHour, size = 184 }: Props) {
  const c = size / 2;
  const rOuter = size * 0.455;
  const rInner = size * 0.36;
  const cap = capacity == null ? 0 : Math.max(0, Math.min(100, capacity));
  const capLen = (2 * Math.PI * rInner * SWEEP) / 360;
  const capOffset = capLen * (1 - cap / 100);
  const startDeg = -SWEEP / 2;
  const capArc = arc(c, c, rInner, startDeg, startDeg + SWEEP);
  const nowPt = nowHour != null && nowHour >= DAY_START && nowHour <= DAY_END ? polar(c, c, rOuter, hourToAngle(nowHour)) : null;
  const gradId = `tv-dial-grad-${size}`;
  const startLbl = polar(c, c, rOuter, startDeg);
  const endLbl = polar(c, c, rOuter, -startDeg);

  return (
    <div className="tv-dial" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${known && capacity != null ? `Capacity ${cap}%` : 'Capacity unknown'}. ${blocks.length} planned blocks between 6:00 and 22:00.`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" className="tv-dial-stop-a" />
            <stop offset="100%" className="tv-dial-stop-b" />
          </linearGradient>
        </defs>

        {/* day track */}
        <path d={arc(c, c, rOuter, startDeg, -startDeg)} className="tv-dial-daytrack" />
        {win && <path d={arc(c, c, rOuter, hourToAngle(win.start), hourToAngle(win.end))} className="tv-dial-window" />}
        {blocks.map((b) => {
          const from = hourToAngle(b.start);
          const to = hourToAngle(b.start + Math.max(b.minutes, 10) / 60);
          return <path key={b.id} d={arc(c, c, rOuter, from + 0.8, Math.max(from + 1.6, to - 0.8))} className={`tv-dial-seg tv-e-${b.energy} is-${b.status}`} />;
        })}
        <text x={startLbl.x - 2} y={startLbl.y + 14} className="tv-dial-hour" textAnchor="middle">6</text>
        <text x={endLbl.x + 2} y={endLbl.y + 14} className="tv-dial-hour" textAnchor="middle">22</text>

        {/* capacity */}
        <path d={capArc} className="tv-dial-captrack" />
        {capacity != null && (
          <path d={capArc} className={`tv-dial-cap ${known ? '' : 'is-assumed'}`} stroke={`url(#${gradId})`}
            strokeDasharray={`${capLen} ${capLen}`} strokeDashoffset={capOffset} />
        )}
        {nowPt && <circle cx={nowPt.x} cy={nowPt.y} r={size * 0.026} className="tv-dial-now" />}
      </svg>
      <div className="tv-dial-center">
        <span className={`tv-dial-value ${known ? '' : 'is-assumed'}`}>{capacity == null ? '–' : cap}<small>%</small></span>
        <span className="tv-dial-label">{label}</span>
      </div>
    </div>
  );
}
