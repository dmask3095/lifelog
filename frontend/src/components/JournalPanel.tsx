import { useEffect, useState } from 'react';
import { getJournal, listJournal, saveJournal, type JournalEntry } from '../api';
import { useRefresh } from '../context/RefreshContext';
import type { SummaryData } from '../types';

interface Props { date: string; summary: SummaryData | null; }

const PROMPTS = [
  "What's one thing you're proud of today?",
  'What could tomorrow look like if you tried 10% harder?',
  'What drained your energy today, and can you reduce it?',
  "What's one thing you learned today?",
  'Who or what are you grateful for right now?',
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

// Prompts anchored in the day's real data: never the same loop twice.
function groundedPrompt(s: SummaryData | null, fallback: string): { text: string; source: string } {
  if (!s) return { text: fallback, source: '' };
  const hurdle = s.hurdles[0];
  if (hurdle) return { text: `You flagged “${hurdle.description}” on “${hurdle.task_title}”. What is the smallest next move, and what would make it 10% easier?`, source: 'from today’s hurdles' };
  if (s.tasks.completed >= 3 && s.body.sleepHours > 0 && s.body.sleepHours < 6) return { text: `You shipped ${s.tasks.completed} tasks on ${s.body.sleepHours}h of sleep. What did that cost, and what would tonight’s version of you want?`, source: 'from tasks + sleep' };
  if (s.capacity.level === 'recovery') return { text: 'Capacity is low today. What is the one thing that would make today feel like enough?', source: 'from your capacity score' };
  if (s.mood && s.mood.score >= 4 && s.habits.completed === s.habits.total && s.habits.total > 0) return { text: `Mood ${s.mood.score}/5 and every habit kept. What made today click, so you can repeat it on purpose?`, source: 'from mood + habits' };
  if (s.mood && s.mood.score <= 2) return { text: `Mood ${s.mood.score}/5 today. Name the heaviest thing, then name one thing that still went okay.`, source: 'from today’s mood' };
  if (s.insight) return { text: `LifeLog noticed: ${s.insight.detail} Does that match how it feels from the inside?`, source: 'from your patterns' };
  if (s.tasks.completed > 0) return { text: `You finished ${s.tasks.completed} of ${s.tasks.total} tasks. Which one mattered most, and why?`, source: 'from today’s tasks' };
  return { text: fallback, source: '' };
}

type Mode = 'write' | 'all';

export default function JournalPanel({ date, summary }: Props) {
  const { tick } = useRefresh();
  const [mode, setMode] = useState<Mode>('write');
  const [content, setContent] = useState('');
  const [existingContent, setExistingContent] = useState<string | null>(null);
  const [noteCountToday, setNoteCountToday] = useState(0);
  const [saved, setSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const prompt = groundedPrompt(summary, PROMPTS[new Date(date + 'T00:00:00').getDay() % PROMPTS.length]);

  const fetchEntries = () => {
    setEntriesLoading(true);
    listJournal().then((res) => setEntries(res.data)).catch(() => setEntries([])).finally(() => setEntriesLoading(false));
  };

  useEffect(() => {
    setContent('');
    setExistingContent(null);
    setNoteCountToday(0);
    setLastSaved('');
    getJournal(date).then((res) => {
      if (res.data) {
        setExistingContent(res.data.content);
        setLastSaved(res.data.updated_at);
        setNoteCountToday(res.data.content.split('\n\n').length);
      }
    }).catch(() => {});
    fetchEntries();
  }, [date, tick]);

  const save = async () => {
    const timeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const note = `${timeLabel}\n${content.trim()}`;
    const fullContent = existingContent ? `${existingContent}\n\n${note}` : note;
    await saveJournal(date, fullContent);
    setExistingContent(fullContent);
    setNoteCountToday((n) => n + 1);
    setContent('');
    setSaved(true);
    setLastSaved(new Date().toLocaleTimeString());
    fetchEntries();
    setTimeout(() => setSaved(false), 2000);
  };

  const totalEntries = entries.length;
  const streak = currentStreak(entries.map((e) => e.date));
  const longest = entries.reduce((max, e) => (wordCount(e.content) > wordCount(max?.content ?? '') ? e : max), entries[0]);

  return (
    <div className="panel">
      <h2>Journal</h2>

      <div className="grocery-view-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button className={`grocery-view-chip ${mode === 'write' ? 'active' : ''}`} onClick={() => setMode('write')}>✍️ Write</button>
        <button className={`grocery-view-chip ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>📖 All entries</button>
      </div>

      {mode === 'write' ? (
        <>
          <div className="card">
            <div className="card-title">💭 Today’s prompt</div>
            <p className="prompt-grounded">{prompt.text}</p>
            {prompt.source && <p className="prompt-src">Grounded {prompt.source}</p>}
          </div>

          {noteCountToday > 0 && (
            <p className="muted">You’ve written {noteCountToday} note{noteCountToday === 1 ? '' : 's'} today. This adds another; nothing gets overwritten.</p>
          )}

          <textarea className="textarea" rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write freely. This is just for you…" />

          {lastSaved && <p style={{ fontSize: 12, color: '#6f829a', textAlign: 'right' }}>Last saved: {lastSaved}</p>}

          <button onClick={save} className="btn-primary" disabled={!content.trim()}>{saved ? '✓ Added' : 'Add note'}</button>

          {existingContent && (
            <div className="card">
              <div className="card-title">📅 Today so far</div>
              <p style={{ fontSize: 14, color: '#dce8f7', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0, position: 'relative' }}>{existingContent}</p>
            </div>
          )}
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
            <p className="empty">Loading your journal…</p>
          ) : entries.length === 0 ? (
            <p className="empty">No entries yet. Write your first one above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entries.map((e) => (
                <div key={e.date} className="card">
                  <div className="card-title">
                    📅 {formatDate(e.date)}
                    {longest && e.date === longest.date && totalEntries > 1 && <span className="grocery-tag" style={{ marginLeft: 8 }}>longest entry</span>}
                  </div>
                  <p style={{ fontSize: 14, color: '#dce8f7', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0, position: 'relative' }}>{e.content}</p>
                  <p style={{ fontSize: 11, color: '#555', marginTop: 10, textAlign: 'right' }}>{wordCount(e.content)} words</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
