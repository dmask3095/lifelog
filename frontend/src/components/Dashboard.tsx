import { useEffect, useMemo, useState } from 'react';
import ScoreRing from './ScoreRing';
import { getRange } from '../api';
import { fmtMinutes, formatShort, shiftDate } from '../lib/dates';
import { getMvd, setMvd, MVD_EVENT } from '../lib/mvd';
import { TIME_CATEGORY_META, type Insight, type RangeData, type SummaryData, type TimeCategory } from '../types';
import type { Tab } from '../App';

type Range = 'day' | 'week' | 'month';

interface Props {
  date: string;
  today: string;
  data: SummaryData | null;
  loading: boolean;
  onNavigate: (tab: Tab) => void;
}

function Card({ title, icon, children, className = '' }: { title: string; icon: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-title">{icon} {title}</div>
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

function InsightBlock({ insight, loggedDays }: { insight: Insight | null; loggedDays: number }) {
  if (!insight) {
    const left = Math.max(0, 7 - loggedDays);
    return (
      <p className="muted">
        {left > 0
          ? `Patterns unlock after 7 logged days (${loggedDays}/7 so far). Keep logging sleep, mood and tasks and LifeLog will start telling you what actually moves your days.`
          : 'No strong pattern yet. Keep logging; relationships need a few contrasting days (good sleep vs short sleep, deep-work days vs none) to show up.'}
      </p>
    );
  }
  return (
    <>
      <div className="insight-title">
        {insight.title}
        <span className={`badge ${insight.confidence}`}>{insight.confidence === 'solid' ? 'solid · n=' + insight.n : 'early signal · n=' + insight.n}</span>
      </div>
      <p className="insight-detail">{insight.detail}</p>
    </>
  );
}

function buildReview(data: SummaryData): string {
  const parts: string[] = [];
  const c = data.capacity;
  if (c.score != null) {
    const bits = [
      data.body.sleepHours > 0 ? `${data.body.sleepHours}h sleep` : null,
      data.mood ? `mood ${data.mood.score}/5` : null,
      data.health.totalWater > 0 ? `${(data.health.totalWater / 1000).toFixed(1)}L water` : null,
    ].filter(Boolean);
    parts.push(`Capacity ${c.score}% (${c.level}): ${bits.join(', ')}.`);
  } else {
    parts.push('Capacity unknown until sleep or mood is logged.');
  }
  if (data.tasks.total === 0) parts.push('No tasks on the board yet.');
  else {
    parts.push(`${data.tasks.completed} of ${data.tasks.total} tasks done (${data.tasks.productivityScore}%)${data.tasks.overdue ? `, ${data.tasks.overdue} carried over` : ''}.`);
    if (data.hurdles.length > 0) parts.push(`${data.hurdles.length} open hurdle${data.hurdles.length > 1 ? 's' : ''}: ${data.hurdles.slice(0, 2).map((h) => `“${h.task_title}”`).join(', ')}.`);
  }
  if (data.habits.total > 0) {
    const best = [...data.habits.items].sort((a, b) => b.currentStreak - a.currentStreak)[0];
    parts.push(`Habits ${data.habits.completed}/${data.habits.total} kept${best && best.currentStreak > 1 ? `; longest live streak ${best.icon} ${best.name} at ${best.currentStreak} days` : ''}.`);
  }
  const dw = data.time.byCategory.deep_work ?? 0;
  const wasted = data.time.byCategory.wasted ?? 0;
  if (dw > 0 || wasted > 0) parts.push(`${dw > 0 ? fmtMinutes(dw) + ' deep work' : ''}${dw > 0 && wasted > 0 ? ', ' : ''}${wasted > 0 ? fmtMinutes(wasted) + ' scrolling' : ''}.`);
  if (c.level === 'recovery') parts.push('Recovery day: two must-dos, bronze habits, early night. That is a win.');
  else if (c.level === 'peak') parts.push('Peak day: put the hardest thing first while the tank is full.');
  else if (c.level === 'steady') parts.push('Steady day: protect one deep-work block and let the rest be light.');
  return parts.join(' ');
}

function RangeChart({ days }: { days: RangeData['days'] }) {
  const W = 600;
  const H = 170;
  const padL = 26;
  const padB = 22;
  const innerW = W - padL - 6;
  const innerH = H - padB - 8;
  const n = days.length;
  const slot = innerW / n;
  const barW = Math.max(3, slot * 0.55);
  const y = (pct: number) => 8 + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;
  const sleepPts = days.map((d, i) => (d.sleepMinutes != null ? `${padL + i * slot + slot / 2},${y((d.sleepMinutes / 600) * 100)}` : null));
  const sleepPath = sleepPts.filter(Boolean).length > 1
    ? sleepPts.reduce((acc, p, i) => (p ? `${acc}${acc && sleepPts[i - 1] ? 'L' : 'M'}${p}` : acc), '')
    : '';
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Task completion, sleep and mood by day">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - 6} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.08)" />
            <text x={padL - 6} y={y(g) + 4} fontSize="10" fill="#6f829a" textAnchor="end">{g}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const p = d.productivity;
          return (
            <g key={d.date}>
              {p != null && <rect x={x} y={y(p)} width={barW} height={8 + innerH - y(p)} rx={2} fill={p >= 70 ? '#7ce2b6' : p >= 40 ? '#59c3ff' : '#ff9b6b'} opacity={0.9} />}
              {p == null && d.logged && <rect x={x} y={y(2)} width={barW} height={3} rx={1} fill="rgba(255,255,255,0.15)" />}
              {d.mood != null && <circle cx={x + barW / 2} cy={y(d.mood * 20)} r={3.2} fill="#ff9b6b" stroke="#08111f" strokeWidth={1} />}
              {(n <= 10 || i % Math.ceil(n / 10) === 0) && (
                <text x={x + barW / 2} y={H - 6} fontSize="10" fill="#8ab7d7" textAnchor="middle">{n <= 10 ? formatShort(d.date).split(',')[0] : d.date.slice(5)}</text>
              )}
            </g>
          );
        })}
        {sleepPath && <path d={sleepPath} fill="none" stroke="#aa66ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-dot" style={{ background: '#7ce2b6' }} />Task completion %</span>
        <span><i className="legend-dot" style={{ background: '#aa66ff' }} />Sleep (10h = 100)</span>
        <span><i className="legend-dot" style={{ background: '#ff9b6b' }} />Mood (5 = 100)</span>
      </div>
    </>
  );
}

function buildShareText(r: RangeData, label: string): string {
  const t = r.totals;
  const lines = [
    `My ${label} in signals · LifeLog`,
    `• ${t.tasksCompleted}/${t.tasksTotal} tasks shipped${t.avgProductivity != null ? ` (${Math.round(t.avgProductivity)}% avg completion)` : ''}`,
    t.avgSleepMinutes != null ? `• ${(t.avgSleepMinutes / 60).toFixed(1)}h avg sleep` : null,
    t.avgMood != null ? `• mood ${t.avgMood.toFixed(1)}/5` : null,
    t.deepWorkMinutes > 0 ? `• ${(t.deepWorkMinutes / 60).toFixed(1)}h deep work` : null,
    r.wrap.bestHabit ? `• best habit: ${r.wrap.bestHabit.icon} ${r.wrap.bestHabit.name} ${r.wrap.bestHabit.kept}/${r.wrap.bestHabit.possible}` : null,
    r.wrap.topInsight ? `• pattern: ${r.wrap.topInsight.detail}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function RangeView({ date, range }: { date: string; range: Exclude<Range, 'day'> }) {
  const [data, setData] = useState<RangeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const start = shiftDate(date, range === 'week' ? -6 : -29);

  useEffect(() => {
    setLoading(true);
    getRange(start, date).then((res) => setData(res.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [start, date]);

  if (loading) return <p className="empty">Crunching your {range}…</p>;
  if (!data) return <p className="empty">Could not load this range.</p>;

  const t = data.totals;
  const label = range === 'week' ? 'week' : 'month';
  const shareText = buildShareText(data, label);
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`${range === 'week' ? 'Last 7 days' : 'Last 30 days'} · ${formatShort(start)} → ${formatShort(date)}`} icon="📈">
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="stat-val">{t.daysLogged}<small style={{ fontSize: 12, color: '#6f829a' }}>/{t.daysInRange}</small></div><div className="stat-lab">days logged</div></div>
          <div className="stat"><div className="stat-val">{t.tasksCompleted}</div><div className="stat-lab">tasks done · {t.avgProductivity != null ? Math.round(t.avgProductivity) + '% avg' : 'no tasks'}</div></div>
          <div className="stat"><div className="stat-val">{t.avgSleepMinutes != null ? (t.avgSleepMinutes / 60).toFixed(1) + 'h' : '–'}</div><div className="stat-lab">avg sleep</div></div>
          <div className="stat"><div className="stat-val">{t.avgMood != null ? t.avgMood.toFixed(1) : '–'}</div><div className="stat-lab">avg mood /5</div></div>
          <div className="stat"><div className="stat-val">{fmtMinutes(t.deepWorkMinutes)}</div><div className="stat-lab">deep work</div></div>
          <div className="stat"><div className="stat-val">{t.hurdles}</div><div className="stat-lab">hurdles flagged</div></div>
        </div>
        <RangeChart days={data.days} />
      </Card>

      {range === 'month' && (
        <Card title="Mood pixels" icon="🟦">
          <div className="heat">
            {data.days.map((d) => (
              <div key={d.date} className="heat-cell" data-mood={d.mood ?? undefined} title={`${formatShort(d.date)} · mood ${d.mood ?? 'not logged'}`} />
            ))}
          </div>
        </Card>
      )}

      {data.habitStats.length > 0 && (
        <Card title="Habit consistency" icon="🔥">
          {data.habitStats.map((h) => {
            const pct = h.possible > 0 ? Math.round((h.kept / h.possible) * 100) : 0;
            return (
              <div key={h.id} className="bar-row">
                <div className="bar-head"><span>{h.icon} {h.name}</span><span style={{ color: pct >= 70 ? '#84f0c2' : pct >= 40 ? '#7dd5ff' : '#ffb28b', fontWeight: 700 }}>{h.kept}/{h.possible} · {pct}%</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: pct >= 70 ? '#7ce2b6' : pct >= 40 ? '#59c3ff' : '#ff9b6b' }} /></div>
              </div>
            );
          })}
        </Card>
      )}

      <Card title={`What moves your ${label}`} icon="🧪" className="insight-card">
        {data.insights.length === 0 ? (
          <p className="muted">No reliable pattern in this window yet. Insights need at least 3 days on each side of a comparison (for example 3 days of 7h+ sleep and 3 shorter nights).</p>
        ) : (
          <div className="insight-list">
            {data.insights.map((ins) => (
              <div key={ins.id} className="insight-item">
                <div className="insight-title">{ins.title}<span className={`badge ${ins.confidence}`}>{ins.confidence} · n={ins.n}</span></div>
                <div className="insight-detail">{ins.detail}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={range === 'week' ? 'Weekly wrap' : 'Monthly synthesis'} icon="🎁" className="wrap-card">
        {data.wrap.wins.length > 0 ? (
          <ul className="wrap-list">
            {data.wrap.wins.map((w) => <li key={w}>{w}</li>)}
            {data.wrap.bestDay && <li>Best day: {formatShort(data.wrap.bestDay.date)} at {data.wrap.bestDay.productivity}% completion</li>}
            {data.wrap.bestHabit && <li>Most consistent habit: {data.wrap.bestHabit.icon} {data.wrap.bestHabit.name} ({data.wrap.bestHabit.kept}/{data.wrap.bestHabit.possible})</li>}
          </ul>
        ) : (
          <p className="muted" style={{ marginBottom: 10 }}>Nothing logged in this window yet. One line a day in the Omni-Bar is enough.</p>
        )}
        <p className="insight-detail" style={{ marginBottom: 12 }}><strong style={{ color: '#9cf3cd' }}>Next {label}: </strong>{data.wrap.focus}</p>
        <div className="share-box">{shareText}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn-sm blue" onClick={copy}>{copied ? '✓ Copied' : 'Copy “my ' + label + ' in signals”'}</button>
        </div>
      </Card>
    </div>
  );
}

export default function Dashboard({ date, today, data, loading, onNavigate }: Props) {
  const [range, setRange] = useState<Range>('day');
  const recommended = data?.capacity.mvdRecommended ?? false;
  const [mvd, setMvdState] = useState(() => getMvd(date, recommended));

  useEffect(() => { setMvdState(getMvd(date, recommended)); }, [date, recommended]);
  useEffect(() => {
    const onEvt = () => setMvdState(getMvd(date, recommended));
    window.addEventListener(MVD_EVENT, onEvt);
    return () => window.removeEventListener(MVD_EVENT, onEvt);
  }, [date, recommended]);

  const timeEntries = useMemo(() => {
    if (!data) return [] as Array<[TimeCategory, number]>;
    return (Object.entries(data.time.byCategory) as Array<[TimeCategory, number]>).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  }, [data]);
  const timeMax = Math.max(60, ...timeEntries.map(([, m]) => m));

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div className="range-tabs">
        {(['day', 'week', 'month'] as Range[]).map((r) => (
          <button key={r} className={`range-tab ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
            {r === 'day' ? (date === today ? 'Today' : 'Day') : r === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>

      {range !== 'day' && <RangeView date={date} range={range} />}

      {range === 'day' && loading && !data && <p className="empty" style={{ padding: 40 }}>Loading your day…</p>}

      {range === 'day' && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Capacity" icon="🔋">
            <div className="cap-card">
              <ScoreRing score={data.capacity.score ?? 0} color={data.capacity.level === 'recovery' ? '#ff9b6b' : data.capacity.level === 'peak' ? '#7ce2b6' : data.capacity.level === 'steady' ? '#59c3ff' : '#3a4a60'} size={96} />
              <div>
                <div className={`cap-level ${data.capacity.level}`}>{data.capacity.level === 'unknown' ? 'Not enough signal' : `${data.capacity.level} day`}</div>
                <div className="cap-headline">{data.capacity.headline}</div>
                <div className="cap-signals">
                  <span className={`chip small clickable ${data.capacity.signals.sleep ? 'tone-ok' : 'tone-muted'}`} onClick={() => onNavigate('health')}>😴 {data.capacity.signals.sleep ? `${data.body.sleepHours}h sleep` : 'log sleep'}</span>
                  <span className={`chip small clickable ${data.capacity.signals.mood ? 'tone-ok' : 'tone-muted'}`} onClick={() => onNavigate('health')}>😊 {data.capacity.signals.mood ? `mood ${data.mood?.score}/5` : 'log mood'}</span>
                  <span className={`chip small clickable ${data.capacity.signals.water ? 'tone-ok' : 'tone-muted'}`} onClick={() => onNavigate('health')}>💧 {data.capacity.signals.water ? `${data.health.totalWater} ml` : 'log water'}</span>
                </div>
              </div>
            </div>
            <div className={`mvd-toggle ${mvd ? 'on' : ''}`}>
              <div>
                <strong>Minimum Viable Day {mvd ? 'is on' : data.capacity.mvdRecommended ? 'recommended' : ''}</strong>
                <span>{mvd ? 'Tasks show your top 2 only; habits drop to their bronze floor.' : 'Low-capacity days get a smaller, kinder plan. Flip it on anytime.'}</span>
              </div>
              <button type="button" className={`switch ${mvd ? 'on' : ''}`} aria-label="Toggle Minimum Viable Day" onClick={() => { setMvd(date, !mvd); setMvdState(!mvd); }} />
            </div>
          </Card>

          <Card title="Today’s scores" icon="🎯">
            <div className="rings-row">
              <ScoreRing score={data.tasks.productivityScore} color="#59c3ff" label="Tasks" size={78} />
              <ScoreRing score={data.habits.pct} color="#ffbf5e" label="Habits" size={78} />
              <ScoreRing score={data.health.healthScore} color="#7ce2b6" label="Health" size={78} />
              <ScoreRing score={data.health.waterGoalPercent} color="#0099ff" label="Water" size={78} />
              <ScoreRing score={data.body.sleepPercent} color="#aa66ff" label="Sleep" size={78} />
            </div>
          </Card>

          <Card title="Right now" icon="⚡">
            <div className="stat-grid">
              <button className="stat" onClick={() => onNavigate('agenda')}>
                <div className="stat-val">{data.tasks.total - data.tasks.completed}</div>
                <div className="stat-lab">open tasks</div>
                {data.tasks.overdue > 0 && <div className="stat-sub" style={{ color: '#ffb28b' }}>{data.tasks.overdue} carried over</div>}
              </button>
              <button className="stat" onClick={() => onNavigate('agenda')}>
                <div className="stat-val" style={{ color: data.hurdles.length ? '#ffb28b' : undefined }}>{data.hurdles.length}</div>
                <div className="stat-lab">open hurdles</div>
                {data.hurdles.length > 0 && <div className="stat-sub" style={{ color: '#ffb28b' }}>tap to unblock</div>}
              </button>
              <button className="stat" onClick={() => onNavigate('habits')}>
                <div className="stat-val">{data.habits.completed}<small style={{ fontSize: 12, color: '#6f829a' }}>/{data.habits.total}</small></div>
                <div className="stat-lab">habits kept</div>
              </button>
              <button className="stat" onClick={() => onNavigate('health')}>
                <div className="stat-val">{data.mood ? ['😞', '😕', '😐', '😊', '🤩'][data.mood.score - 1] : '–'}</div>
                <div className="stat-lab">{data.mood ? `mood ${data.mood.score}/5` : 'no mood yet'}</div>
              </button>
              <button className="stat" onClick={() => onNavigate('health')}>
                <div className="stat-val">{data.time.totalMinutes > 0 ? fmtMinutes(data.time.byCategory.deep_work ?? 0) : '–'}</div>
                <div className="stat-lab">deep work</div>
              </button>
              <button className="stat" onClick={() => onNavigate('journal')}>
                <div className="stat-val">{data.journal.noteCount}</div>
                <div className="stat-lab">journal notes</div>
              </button>
            </div>
          </Card>

          <Card title="Your pattern" icon="🧪" className="insight-card">
            <InsightBlock insight={data.insight} loggedDays={data.loggedDays30} />
            {data.insightCount > 1 && (
              <button className="btn-sm blue" style={{ marginTop: 12 }} onClick={() => setRange('month')}>See all {data.insightCount} patterns</button>
            )}
          </Card>

          {data.hurdles.length > 0 && (
            <Card title="Hurdles" icon="⚠️">
              {data.hurdles.map((h) => (
                <div key={h.id} className="hurdle-row" style={{ marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#ffb28b', fontWeight: 700 }}>{h.task_title}</div>
                    <div>{h.description}</div>
                  </div>
                  <button className="btn-xs orange" onClick={() => onNavigate('agenda')}>Unblock</button>
                </div>
              ))}
            </Card>
          )}

          {timeEntries.length > 0 && (
            <Card title="Where the time went" icon="⏱">
              {timeEntries.map(([cat, minutes]) => (
                <div key={cat} className="bar-row">
                  <div className="bar-head"><span>{TIME_CATEGORY_META[cat].icon} {TIME_CATEGORY_META[cat].label}</span><span style={{ color: TIME_CATEGORY_META[cat].color, fontWeight: 700 }}>{fmtMinutes(minutes)}</span></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(minutes / timeMax) * 100}%`, background: TIME_CATEGORY_META[cat].color }} /></div>
                </div>
              ))}
            </Card>
          )}

          <Card title="Day review" icon="🧠">
            <p className="review-text">{buildReview(data)}</p>
          </Card>
        </div>
      )}

      {range === 'day' && !loading && !data && (
        <p className="empty" style={{ padding: 40 }}>Could not load this day. Is the API running?</p>
      )}
    </div>
  );
}
