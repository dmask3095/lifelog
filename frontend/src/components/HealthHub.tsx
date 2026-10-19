import { useState } from 'react';
import FuelPanel from './FuelPanel';
import TimePanel from './TimePanel';
import BodyPanel from './BodyPanel';
import MoodPanel from './MoodPanel';

interface Props { date: string; onChanged: () => void; }

type SubTab = 'fuel' | 'time' | 'sleep' | 'mood';

const SUB_TABS: { id: SubTab; icon: string; label: string }[] = [
  { id: 'fuel', icon: '💧', label: 'Fuel' },
  { id: 'time', icon: '⏱', label: 'Time' },
  { id: 'sleep', icon: '😴', label: 'Sleep' },
  { id: 'mood', icon: '😊', label: 'Mood' },
];

export default function HealthHub({ date, onChanged }: Props) {
  const [sub, setSub] = useState<SubTab>('fuel');

  return (
    <div className="panel">
      <div className="grocery-view-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} className={`grocery-view-chip ${sub === t.id ? 'active' : ''}`} onClick={() => setSub(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {sub === 'fuel' && <FuelPanel date={date} onChanged={onChanged} />}
      {sub === 'time' && <TimePanel date={date} onChanged={onChanged} />}
      {sub === 'sleep' && <BodyPanel date={date} onChanged={onChanged} />}
      {sub === 'mood' && <MoodPanel date={date} onChanged={onChanged} />}
    </div>
  );
}
