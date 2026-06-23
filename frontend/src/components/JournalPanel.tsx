import { useState, useEffect } from 'react';
import { api } from '../api';

interface Props { date: string; }

interface Entry {
  date: string;
  content: string;
  updated_at: string;
}

const PROMPTS = [
  "What's one thing you're proud of today?",
  "What could tomorrow look like if you tried 10% harder?",
  "What drained your energy today — and can you reduce it?",
  "What's one thing you learned today?",
  "Who or what are you grateful for right now?",
];

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function currentStreak(datesDesc: string[]): number {
  if (datesDesc.length === 0) return 0;
  let streak = 1;
  for (let i = 0; i < datesDesc.length - 1; i++) {
    const cur = new Date(datesDesc[i] + 'T00:00:00').getTime();
    const next = new Date(datesDesc[i + 1] + 'T00:00:00').getTime();
    if (Math.round((cur - next) / 86400000) === 1) streak++;
    else break;
  }
  return streak;
}

type Mode = 'write' | 'all';

export default function JournalPanel({ date }: Props) {
  const [mode, setMode] = useState<Mode>('write');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const prompt = PROMPTS[new Date().getDay() % PROMPTS.length];

  const fetchEntries = () => {
    setEntriesLoading(true);
    api.get('/journal')
      .then(res => setEntries(res.data))
      .catch(() => setEntries([]))
      .finally(() => setEntriesLoading(false));
  };

  useEffect(() => {
    api.get(`/journal/${date}`)
      .then(res => { if (res.data) { setContent(res.data.content); setLastSaved(res.data.updated_at); } })
      .catch(() => {});
    fetchEntries();
  }, [date]);

  const save = async () => {
    await api.post('/journal', { date, content });
    setSaved(true);
    setLastSaved(new Date().toLocaleTimeString());
    fetchEntries();
    setTimeout(() => setSaved(false), 2000);
  };

  const totalEntries = entries.length;
  const streak = currentStreak(entries.map(e => e.date));
  const longest = entries.reduce((max, e) => (wordCount(e.content) > wordCount(max?.content ?? '') ? e : max), entries[0]);

  return (
    <div className="panel">
      <h2>Journal</h2>

      <div className="grocery-view-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button className={`grocery-view-chip ${mode === 'write' ? 'active' : ''}`} onClick={() => setMode('write')}>
          ✍️ Write
        </button>
        <button className={`grocery-view-chip ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>
          📖 All Entries
        </button>
      </div>

      {mode === 'write' ? (
        <>
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
        </>
      ) : (
        <>
          {totalEntries > 0 && (
            <div className="grocery-stat-grid">
              <div className="grocery-stat-card">
                <div className="grocery-stat-label">Entries written</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#edf4ff' }}>{totalEntries}</div>
              </div>
              <div className="grocery-stat-card">
                <div className="grocery-stat-label">Current streak</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#7ce2b6' }}>{streak} day{streak === 1 ? '' : 's'}</div>
              </div>
            </div>
          )}

          {entriesLoading ? (
            <p className="empty">Loading your journal...</p>
          ) : entries.length === 0 ? (
            <p className="empty">No entries yet. Write your first one above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entries.map(e => (
                <div key={e.date} className="card">
                  <div className="card-title">
                    📅 {formatDate(e.date)}
                    {longest && e.date === longest.date && totalEntries > 1 && (
                      <span className="grocery-tag" style={{ marginLeft: 8 }}>longest entry</span>
                    )}
                  </div>
                  <p style={{ fontSize: 14, color: '#dce8f7', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                    {e.content}
                  </p>
                  <p style={{ fontSize: 11, color: '#555', marginTop: 10, textAlign: 'right' }}>
                    {wordCount(e.content)} words
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
