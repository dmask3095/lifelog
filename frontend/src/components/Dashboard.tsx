import { useState } from 'react';
import ScoreRing from './ScoreRing';
import type { SummaryData, GroceryCategory } from '../types';

const PRIORITY_CONFIG = {
  urgent: { color: '#ff4444', bg: '#1a0000', label: '🔴 Urgent' },
  high:   { color: '#ff8800', bg: '#1a0d00', label: '🟠 High' },
  medium: { color: '#4488ff', bg: '#001833', label: '🔵 Medium' },
  low:    { color: '#666666', bg: '#141414', label: '⚫ Low' },
};

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const;

type Range = 'daily' | 'weekly' | 'monthly';

function Bar({ label, minutes, color, max }: { label: string; minutes: number; color: string; max: number }) {
  const pct = max > 0 ? Math.min(100, (minutes / max) * 100) : 0;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const display = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#ccc' }}>{label}</span>
        <span style={{ fontSize: 13, color, fontWeight: 600 }}>{display}</span>
      </div>
      <div style={{ height: 8, background: '#2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function generateAnalysis(data: SummaryData): string {
  const { tasks, health, body, time, hurdles } = data;
  const parts: string[] = [];

  if (tasks.total === 0) {
    parts.push("No tasks were logged today.");
  } else {
    const rate = tasks.productivityScore;
    if (rate === 100) parts.push(`Exceptional day — all ${tasks.total} tasks completed.`);
    else if (rate >= 70) parts.push(`Strong productivity at ${rate}% — ${tasks.completed} of ${tasks.total} tasks done.`);
    else if (rate >= 40) parts.push(`Moderate day — ${tasks.completed} of ${tasks.total} tasks completed (${rate}%).`);
    else parts.push(`Low output today — only ${tasks.completed} of ${tasks.total} tasks completed.`);

    if (tasks.needsAttention > 0) parts.push(`${tasks.needsAttention} task${tasks.needsAttention > 1 ? 's' : ''} need attention.`);
    if (hurdles.length > 0) parts.push(`${hurdles.length} hurdle${hurdles.length > 1 ? 's' : ''} blocked progress.`);
  }

  const waterPct = health.waterGoalPercent;
  if (waterPct >= 100) parts.push("Hydration goal fully met — great.");
  else if (waterPct >= 60) parts.push(`Hydration at ${waterPct}% — slightly under goal.`);
  else parts.push(`Low water intake at ${waterPct}% of daily goal.`);

  const sleep = body.sleepHours;
  if (sleep >= 7) parts.push(`Good sleep at ${sleep} hours.`);
  else if (sleep >= 5) parts.push(`Sleep was ${sleep} hours — below the recommended 7.`);
  else if (sleep > 0) parts.push(`Only ${sleep} hours of sleep logged — rest is critical.`);

  const wasted = time.byCategory['wasted'] || 0;
  if (wasted >= 120) parts.push(`${Math.round(wasted / 60)}h wasted — consider identifying what pulled your focus.`);
  else if (wasted > 0) parts.push(`${wasted} minutes of time wasted noted.`);

  if (health.fruits.length > 0) parts.push(`Ate fruits today: ${health.fruits.join(', ')}.`);
  if (health.foodNotes.length > 0 && health.fruits.length === 0) parts.push("Food was logged but no fruits recorded.");
  if (data.groceries.eatAsapCount > 0) parts.push(`${data.groceries.eatAsapCount} grocery item${data.groceries.eatAsapCount > 1 ? 's need' : ' needs'} to be eaten soon.`);
  if (data.groceries.mealIdeas.length > 0) parts.push(`Kitchen idea: ${data.groceries.mealIdeas[0].title}.`);

  const score = Math.round((tasks.productivityScore + health.healthScore) / 2);
  if (score >= 80) parts.push(`Overall: strong day. Keep the momentum.`);
  else if (score >= 50) parts.push(`Overall: decent day with room to improve.`);
  else parts.push(`Overall: challenging day. Tomorrow is a fresh start.`);

  return parts.join(' ');
}

interface Props {
  data: SummaryData | null;
  loading: boolean;
}

export default function Dashboard({ data, loading }: Props) {
  const [range, setRange] = useState<Range>('daily');
  const [openGroceryCategory, setOpenGroceryCategory] = useState<GroceryCategory | null>(null);

  const timeMax = data ? Math.max(...Object.values(data.time.byCategory).map(Number), 60) : 60;
  const groupedTasks = data
    ? PRIORITY_ORDER.map(priority => ({
        priority,
        tasks: data.tasks.items.filter(task => task.priority === priority),
      }))
    : [];

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Range selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(['daily', 'weekly', 'monthly'] as Range[]).map(r => (
          <button key={r} onClick={() => setRange(r)} style={{
            padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
            background: range === r ? '#4488ff' : '#1a1a1a',
            color: range === r ? '#fff' : '#666',
            fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
          }}>{r.charAt(0).toUpperCase() + r.slice(1)}</button>
        ))}
        {range !== 'daily' && (
          <span style={{ color: '#555', fontSize: 13, alignSelf: 'center', marginLeft: 8 }}>
            Weekly & monthly views coming soon — showing today's data
          </span>
        )}
      </div>

      {loading && <p style={{ color: '#555', textAlign: 'center', padding: 40 }}>Loading your day...</p>}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Score rings */}
          <Card title="Today's Scores" icon="🎯">
            <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
              <ScoreRing score={data.tasks.productivityScore} color="#4488ff" label="Productivity" />
              <ScoreRing score={data.health.healthScore} color="#00cc88" label="Health" />
              <ScoreRing score={Math.min(100, data.health.waterGoalPercent)} color="#0099ff" label="Hydration" />
              <ScoreRing score={Math.min(100, Math.round((data.body.sleepHours / 8) * 100))} color="#aa66ff" label="Sleep" />
            </div>
          </Card>

          {/* Tasks */}
          <Card title="Tasks" icon="✅">
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Total', val: data.tasks.total, color: '#888' },
                { label: 'Completed', val: data.tasks.completed, color: '#00cc88' },
                { label: 'Ongoing', val: data.tasks.ongoing, color: '#4488ff' },
                { label: 'Needs Attention', val: data.tasks.needsAttention, color: '#ff8800' },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 80, background: '#1e1e1e', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {data.tasks.items.length > 0 && (
              <div style={{ display: 'grid', gap: 12 }}>
                {groupedTasks.map(({ priority, tasks }) => {
                  const cfg = PRIORITY_CONFIG[priority];
                  return (
                    <div key={priority} style={{
                      padding: 12,
                      borderRadius: 16,
                      background: '#121212',
                      border: `1px solid ${cfg.color}33`,
                      boxShadow: `inset 0 0 0 1px ${cfg.color}12`,
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', background: cfg.bg,
                        borderRadius: 10, marginBottom: tasks.length > 0 ? 10 : 0,
                        border: `1px solid ${cfg.color}33`,
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                        <span style={{ fontSize: 12, color: cfg.color, background: `${cfg.color}22`, padding: '2px 8px', borderRadius: 10 }}>
                          {tasks.filter(task => task.status === 'completed').length}/{tasks.length}
                        </span>
                      </div>
                      {tasks.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {tasks.map(task => (
                            <div key={task.id} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '8px 12px', background: '#1e1e1e', borderRadius: 8,
                              borderLeft: `3px solid ${task.status === 'completed' ? '#00cc88' : task.status === 'ongoing' ? '#4488ff' : task.status === 'needs_attention' ? '#ff8800' : '#444'}`
                            }}>
                              <span style={{ fontSize: 13, color: '#ccc' }}>{task.title}</span>
                              <span style={{ fontSize: 11, color: '#555' }}>
                                {task.status.replace('_', ' ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{
                          minHeight: 56,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 12,
                          border: '1px dashed #2a2a2a',
                          color: '#555',
                          fontSize: 13,
                        }}>
                          No {priority} tasks today.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Time breakdown */}
          <Card title="Time Breakdown" icon="⏱">
            {Object.keys(data.time.byCategory).length === 0
              ? <p style={{ color: '#555', fontSize: 13 }}>No time entries logged today.</p>
              : <>
                <Bar label="⏱ Time Wasted" minutes={data.time.byCategory['wasted'] || 0} color="#ff4444" max={timeMax} />
                <Bar label="😴 Time Rested" minutes={data.time.byCategory['rested'] || 0} color="#aa66ff" max={timeMax} />
                <Bar label="🍳 Cooking" minutes={data.time.byCategory['cooking'] || 0} color="#ff8800" max={timeMax} />
                <Bar label="🍽 Eating" minutes={data.time.byCategory['eating'] || 0} color="#00cc88" max={timeMax} />
              </>
            }
          </Card>

          {/* Health */}
          <Card title="Health" icon="💚">
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#ccc' }}>💧 Water</span>
                <span style={{ fontSize: 13, color: '#4488ff', fontWeight: 600 }}>{data.health.totalWater}ml / 2500ml</span>
              </div>
              <div style={{ height: 10, background: '#2a2a2a', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${data.health.waterGoalPercent}%`, background: 'linear-gradient(90deg, #4488ff, #00ccff)', borderRadius: 5, transition: 'width 1s ease' }} />
              </div>
            </div>
            {data.health.fruits.length > 0 && (
              <div style={{ marginBottom: 10, fontSize: 13, color: '#ccc' }}>
                🍎 Fruits: <span style={{ color: '#00cc88' }}>{data.health.fruits.join(', ')}</span>
              </div>
            )}
            {data.health.foodNotes.length > 0 && (
              <div style={{ fontSize: 13, color: '#ccc' }}>
                🥗 Food: <span style={{ color: '#aaa' }}>{data.health.foodNotes.join('; ')}</span>
              </div>
            )}
          </Card>

          {/* Body */}
          <Card title="Body" icon="🛌">
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#aa66ff' }}>{data.body.sleepHours}h</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Sleep</div>
                <div style={{ fontSize: 11, color: data.body.sleepHours >= 7 ? '#00cc88' : '#ff8800', marginTop: 4 }}>
                  {data.body.sleepHours >= 7 ? '✓ Goal met' : `${(7 - data.body.sleepHours).toFixed(1)}h short`}
                </div>
              </div>
              <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#4488ff' }}>{data.body.peeCount}</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Bathroom visits</div>
                <div style={{ fontSize: 11, color: data.body.peeCount >= 6 ? '#00cc88' : '#ff8800', marginTop: 4 }}>
                  {data.body.peeCount >= 6 ? '✓ Healthy range' : 'Drink more water'}
                </div>
              </div>
            </div>
          </Card>

          {/* Groceries */}
          <Card title="Groceries" icon="🛒">
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { key: 'tracked' as GroceryCategory, label: 'Tracked', val: data.groceries.total, color: '#9fdcff' },
                { key: 'eatAsap' as GroceryCategory, label: 'Eat ASAP', val: data.groceries.eatAsapCount, color: '#ff8a82' },
                { key: 'cookSoon' as GroceryCategory, label: 'Cook Soon', val: data.groceries.cookSoonCount, color: '#ffbf9d' },
                { key: 'cooked' as GroceryCategory, label: 'Cooked', val: data.groceries.cookedCount, color: '#98f2cb' },
              ].map(s => {
                const isOpen = openGroceryCategory === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setOpenGroceryCategory(isOpen ? null : s.key)}
                    style={{
                      flex: 1, minWidth: 80, background: isOpen ? `${s.color}1a` : '#1e1e1e',
                      borderRadius: 10, padding: '12px 14px', textAlign: 'center', cursor: 'pointer',
                      border: `1px solid ${isOpen ? s.color : 'transparent'}`,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.label}</div>
                  </button>
                );
              })}
            </div>
            {openGroceryCategory && (
              <div style={{ marginBottom: 16, padding: '10px 12px', background: '#1a1a1a', borderRadius: 10, border: '1px solid #2a2a2a' }}>
                {data.groceries.byCategory[openGroceryCategory].length === 0 ? (
                  <p style={{ color: '#555', fontSize: 13, margin: 0 }}>Nothing in this category right now.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.groceries.byCategory[openGroceryCategory].map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#ccc' }}>
                        <span>{item.name}</span>
                        {item.quantity != null && (
                          <span style={{ color: '#777' }}>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {data.groceries.eatAsapItems.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#ff8a82', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  Eat Soon
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.groceries.eatAsapItems.map(item => (
                    <div key={item.id} style={{ padding: '10px 12px', background: '#1e1e1e', borderRadius: 10, borderLeft: '3px solid #ff8a82' }}>
                      <div style={{ fontSize: 13, color: '#edf4ff', fontWeight: 700 }}>{item.name}</div>
                      {item.notes && <div style={{ fontSize: 12, color: '#8fa3bb', marginTop: 4 }}>{item.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.groceries.mealIdeas.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, color: '#98f2cb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  Quick Kitchen Ideas
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.groceries.mealIdeas.slice(0, 2).map(idea => (
                    <div key={idea.title} style={{ padding: '10px 12px', background: '#1e1e1e', borderRadius: 10, border: '1px solid #2a2a2a' }}>
                      <div style={{ fontSize: 13, color: '#edf4ff', fontWeight: 700 }}>{idea.title}</div>
                      <div style={{ fontSize: 12, color: '#8fa3bb', marginTop: 4 }}>{idea.why}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ color: '#555', fontSize: 13 }}>No grocery ideas yet. Add a few kitchen items and they will show up here.</p>
            )}
          </Card>

          {/* Hurdles */}
          {data.hurdles.length > 0 && (
            <Card title="Hurdles" icon="⚠️">
              {data.hurdles.map((h: any) => (
                <div key={h.id} style={{ padding: '10px 12px', background: '#1e1e1e', borderRadius: 8, marginBottom: 6, borderLeft: '3px solid #ff8800' }}>
                  <div style={{ fontSize: 11, color: '#ff8800', marginBottom: 3 }}>{h.task_title}</div>
                  <div style={{ fontSize: 13, color: '#ccc' }}>{h.description}</div>
                </div>
              ))}
            </Card>
          )}

          {/* AI Analysis */}
          <Card title="Day Review" icon="🧠">
            <p style={{ fontSize: 14, color: '#bbb', lineHeight: 1.8, margin: 0 }}>
              {generateAnalysis(data)}
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: `${data.tasks.productivityScore >= 70 ? '🔥' : '📈'} Productivity`, val: `${data.tasks.productivityScore}%`, color: '#4488ff' },
                { label: `${data.health.healthScore >= 70 ? '💪' : '⚠️'} Health`, val: `${data.health.healthScore}%`, color: '#00cc88' },
                { label: '😴 Sleep', val: `${data.body.sleepHours}h`, color: '#aa66ff' },
              ].map(badge => (
                <div key={badge.label} style={{ padding: '6px 14px', background: '#1e1e1e', borderRadius: 20, border: `1px solid ${badge.color}33` }}>
                  <span style={{ fontSize: 12, color: '#888' }}>{badge.label}: </span>
                  <span style={{ fontSize: 12, color: badge.color, fontWeight: 600 }}>{badge.val}</span>
                </div>
              ))}
            </div>
          </Card>

        </div>
      )}

      {!loading && !data && (
        <p style={{ color: '#555', textAlign: 'center', padding: 40 }}>No data found for today.</p>
      )}
    </div>
  );
}
