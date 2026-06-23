import { useState } from 'react';
import { api } from '../api';

interface Props { date: string; }

export default function HealthPanel({ date }: Props) {
  const [water, setWater] = useState(0);
  const [fruits, setFruits] = useState('');
  const [food, setFood] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await api.post('/health-logs', {
      date, water_ml: water, fruits, food_notes: food,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="panel">
      <h2>Health Log</h2>

      <div className="log-section">
        <label>💧 Water intake (ml)</label>
        <div className="water-controls">
          <button onClick={() => setWater(w => Math.max(0, w - 250))} className="btn-sm">−</button>
          <span className="water-amount">{water} ml</span>
          <button onClick={() => setWater(w => w + 250)} className="btn-sm green">+</button>
        </div>
        <div className="water-bar">
          <div className="water-fill" style={{ width: `${Math.min(100, (water / 2500) * 100)}%` }} />
        </div>
        <small>{water >= 2500 ? '🎉 Goal reached!' : `${2500 - water}ml to daily goal`}</small>
      </div>

      <div className="log-section">
        <label>🍎 Fruits eaten today</label>
        <input
          value={fruits}
          onChange={e => setFruits(e.target.value)}
          placeholder="e.g. apple, banana, mango"
          className="input"
        />
      </div>

      <div className="log-section">
        <label>🥗 Food notes</label>
        <textarea
          value={food}
          onChange={e => setFood(e.target.value)}
          placeholder="What did you eat today?"
          className="textarea"
          rows={3}
        />
      </div>

      <button onClick={handleSave} className="btn-primary">
        {saved ? '✓ Saved!' : 'Save Log'}
      </button>
    </div>
  );
}
