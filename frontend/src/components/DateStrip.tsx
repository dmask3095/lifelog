import { dayNumber, relativeLabel, shiftDate, weekdayShort } from '../lib/dates';

interface Props {
  date: string;
  today: string;
  onChange: (date: string) => void;
}

export default function DateStrip({ date, today, onChange }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 5));
  return (
    <div className="date-nav">
      <div className="date-nav-head">
        <button className="date-arrow" onClick={() => onChange(shiftDate(date, -1))} aria-label="Previous day" title="Previous day ( [ )">‹</button>
        <div className="date-label">
          <strong>{relativeLabel(date, today)}</strong>
          <span>{new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <button className="date-arrow" onClick={() => onChange(shiftDate(date, 1))} aria-label="Next day" title="Next day ( ] )">›</button>
      </div>
      <div className="date-strip">
        {days.map((d) => (
          <button
            key={d}
            className={`date-chip ${d === date ? 'active' : ''} ${d === today ? 'is-today' : ''} ${d > today ? 'future' : ''}`}
            onClick={() => onChange(d)}
            aria-label={d}
          >
            <span className="date-chip-wd">{weekdayShort(d)}</span>
            <span className="date-chip-day">{dayNumber(d)}</span>
          </button>
        ))}
        {date !== today && (
          <button className="date-chip jump" onClick={() => onChange(today)}>Today</button>
        )}
      </div>
    </div>
  );
}
