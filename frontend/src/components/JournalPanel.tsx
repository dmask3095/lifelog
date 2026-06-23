import { useState, useEffect } from 'react';
import { api } from '../api';

interface Props { date: string; }

const PROMPTS = [
  "What's one thing you're proud of today?",
  "What could tomorrow look like if you tried 10% harder?",
  "What drained your energy today — and can you reduce it?",
  "What's one thing you learned today?",
  "Who or what are you grateful for right now?",
];

export default function JournalPanel({ date }: Props) {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const prompt = PROMPTS[new Date().getDay() % PROMPTS.length];

  useEffect(() => {
    api.get(`/journal/${date}`)
      .then(res => { if (res.data) { setContent(res.data.content); setLastSaved(res.data.updated_at); } })
      .catch(() => {});
  }, [date]);

  const save = async () => {
    await api.post('/journal', { date, content });
    setSaved(true);
    setLastSaved(new Date().toLocaleTimeString());
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="panel">
      <h2>Journal</h2>

      <div className="card">
        <div className="card-title">💭 Today's prompt</div>
        <p style={{ fontSize: 15, color: '#bbb', fontStyle: 'italic', lineHeight: 1.6 }}>{prompt}</p>
      </div>

      <textarea
        className="textarea"
        rows={10}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write freely. This is just for you..."
      />

      {lastSaved && <p style={{ fontSize: 12, color: '#444', textAlign: 'right' }}>Last saved: {lastSaved}</p>}

      <button onClick={save} className="btn-primary" disabled={!content.trim()}>
        {saved ? '✓ Saved!' : 'Save Entry'}
      </button>

      <div style={{ marginTop: 8 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>📅 Previous entries</div>
        <PreviousEntries currentDate={date} />
      </div>
    </div>
  );
}

function PreviousEntries({ currentDate }: { currentDate: string }) {
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    api.get('/journal')
      .then(res => setEntries(res.data.filter((e: any) => e.date !== currentDate).slice(0, 5)))
      .catch(() => {});
  }, [currentDate]);

  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#444' }}>No previous entries yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(e => (
        <div key={e.date} style={{ padding: '12px 14px', background: '#1a1a1a', borderRadius: 10, border: '1px solid #222' }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{e.date}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{e.preview}...</div>
        </div>
      ))}
    </div>
  );
}
