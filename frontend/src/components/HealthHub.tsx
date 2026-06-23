import { useState } from 'react';
import HealthPanel from './HealthPanel';
import TimePanel from './TimePanel';
import BodyPanel from './BodyPanel';
import MoodPanel from './MoodPanel';

interface Props { date: string; }

type SubTab = 'hydration' | 'time' | 'sleep' | 'mood';

const SUB_TABS: { id: SubTab; icon: string; label: string }[] = [
  { id: 'hydration', icon: '💧', label: 'Hydration' },
  { id: 'time', icon: '⏱', label: 'Time' },
  { id: 'sleep', icon: '😴', label: 'Sleep' },
  { id: 'mood', icon: '😊', label: 'Mood' },
];

export default function HealthHub({ date }: Props) {
  const [sub, setSub] = useState<SubTab>('hydration');

  return (
    <div className="panel">
      <div className="grocery-view-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`grocery-view-chip ${sub === t.id ? 'active' : ''}`}
            onClick={() => setSub(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {sub === 'hydration' && <HealthPanel date={date} />}
      {sub === 'time' && <TimePanel date={date} />}
      {sub === 'sleep' && <BodyPanel date={date} />}
      {sub === 'mood' && <MoodPanel date={date} />}
    </div>
  );
}
