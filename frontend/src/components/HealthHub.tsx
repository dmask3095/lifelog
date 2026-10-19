import { useState } from 'react';
import { Droplets, Clock3, Moon, Smile } from 'lucide-react';
import FuelPanel from './FuelPanel';
import TimePanel from './TimePanel';
import BodyPanel from './BodyPanel';
import MoodPanel from './MoodPanel';

interface Props { date: string; onChanged: () => void; }

type SubTab = 'fuel' | 'time' | 'sleep' | 'mood';

const SUB_TABS: { id: SubTab; icon: typeof Droplets; label: string }[] = [
  { id: 'fuel', icon: Droplets, label: 'Fuel' },
  { id: 'time', icon: Clock3, label: 'Time' },
  { id: 'sleep', icon: Moon, label: 'Sleep' },
  { id: 'mood', icon: Smile, label: 'Mood' },
];

export default function HealthHub({ date, onChanged }: Props) {
  const [sub, setSub] = useState<SubTab>('fuel');

  return (
    <div className="panel">
      <div className="grocery-view-row" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} className={`grocery-view-chip ${sub === t.id ? 'active' : ''}`} onClick={() => setSub(t.id)}>
            <t.icon size={16}/> {t.label}
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
