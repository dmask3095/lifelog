import { useCallback, useEffect, useState } from 'react';
import { getLatestHealth, saveHealth } from '../api';
import { useRefresh } from '../context/RefreshContext';

interface Props { date: string; onChanged: () => void; }

const GOAL = 2500;
const TAGS: Array<{ id: string; label: string; good: boolean }> = [
  { id: 'protein', label: '🍗 Protein', good: true },
  { id: 'produce', label: '🥗 Produce', good: true },
  { id: 'caffeine', label: '☕ Caffeine', good: false },
  { id: 'sugar', label: '🍰 Sugar', good: false },
  { id: 'alcohol', label: '🍷 Alcohol', good: false },
  { id: 'junk', label: '🍟 Junk', good: false },
];

export default function FuelPanel({ date, onChanged }: Props) {
  const { tick } = useRefresh();
  const [water, setWater] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return getLatestHealth(date).then((r) => {
      setWater(r.data?.water_ml ?? 0);
      setTags((r.data?.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean));
      setNotes(r.data?.food_notes ?? '');
    }).catch(() => { setWater(0); setTags([]); setNotes(''); }).finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load, tick]);

  const flash = (msg: string) => { setSaved(msg); setTimeout(() => setSaved(''), 1500); };

  const addWater = async (ml: number) => {
    const next = Math.max(0, water + ml);
    setWater(next);
    await saveHealth({ date, water_ml: next });
    flash(ml > 0 ? `+${ml} ml` : `${ml} ml`);
    onChanged();
  };

  const toggleTag = async (id: string) => {
    const next = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
    setTags(next);
    await saveHealth({ date, tags: next });
    flash('Tags saved');
    onChanged();
  };

  const saveNotes = async () => {
    await saveHealth({ date, food_notes: notes });
    flash('Notes saved');
    onChanged();
  };

  const pct = Math.min(100, Math.round((water / GOAL) * 100));

  return (
    <div className="panel">
      <div className="log-section">
        <label>💧 Hydration {saved && <span className="saved-note" style={{ marginLeft: 8 }}>✓ {saved}</span>}</label>
        <div className="water-big" style={{ margin: '6px 0 8px' }}>{loading ? '…' : water}<small>/ {GOAL} ml</small></div>
        <div className="water-bar"><div className="water-fill" style={{ width: `${pct}%` }} /></div>
        <small style={{ display: 'block', margin: '6px 0 10px' }}>{water >= GOAL ? '🎉 Goal reached' : `${GOAL - water} ml to go`}</small>
        <div className="pill-row">
          <button className="pill" onClick={() => addWater(250)}>+250</button>
          <button className="pill" onClick={() => addWater(500)}>+500</button>
          <button className="pill" onClick={() => addWater(750)}>+750</button>
          <button className="pill ghost" onClick={() => addWater(-250)}>−250</button>
        </div>
      </div>

      <div className="log-section">
        <label>🍽 What fuelled today</label>
        <div className="pill-row" style={{ margin: '8px 0 10px', position: 'relative' }}>
          {TAGS.map((t) => (
            <button key={t.id} type="button" className={`tag-chip ${tags.includes(t.id) ? 'active' : ''} ${!t.good ? 'bad' : ''}`} onClick={() => toggleTag(t.id)}>{t.label}</button>
          ))}
        </div>
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Meals, snacks, how food felt… (optional)" />
        <button className="btn-sm blue" style={{ marginTop: 8 }} onClick={saveNotes}>Save notes</button>
        <p className="muted" style={{ marginTop: 10 }}>Protein and produce feed your Health score; caffeine, sugar and alcohol are tracked so patterns can show up later.</p>
      </div>
    </div>
  );
}
