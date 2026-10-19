import type { DbHandle } from '../database';
import type { OmniPlan } from './omni-parser';

export interface AppliedItem {
  table: string;
  label: string;
  detail: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((w) => w.length > 2));
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((w) => { if (tb.has(w)) inter++; });
  return inter / (ta.size + tb.size - inter);
}

async function findOpenTask(tx: DbHandle, userId: number, phrase: string): Promise<any | null> {
  const open = await tx.all<any>(
    `SELECT id, title, status, priority, date FROM tasks
     WHERE user_id = ? AND status != 'completed' AND pool IN ('today','scheduled','someday')
     ORDER BY date DESC, id DESC LIMIT 200`,
    userId
  );
  let best: any = null;
  let bestScore = 0;
  for (const t of open) {
    const s = similarity(t.title, phrase);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return bestScore >= 0.5 ? best : null;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export async function applyOmniPlan(tx: DbHandle, userId: number, date: string, plan: OmniPlan): Promise<AppliedItem[]> {
  const applied: AppliedItem[] = [];

  if (plan.sleep) {
    await tx.run("DELETE FROM body_logs WHERE user_id = ? AND date = ? AND type = 'sleep'", userId, date);
    await tx.run(
      "INSERT INTO body_logs (user_id, date, type, time, duration_minutes, note) VALUES (?, ?, 'sleep', ?, ?, ?)",
      userId, date, plan.sleep.start, plan.sleep.minutes, plan.sleep.source
    );
    const h = Math.floor(plan.sleep.minutes / 60);
    const m = plan.sleep.minutes % 60;
    applied.push({ table: 'body_logs', label: 'Sleep', detail: `${plan.sleep.start} → ${plan.sleep.end} · ${h}h ${m}m` });
  }

  if (plan.waterMl || plan.fuel.notes.length > 0) {
    const existing = await tx.get<any>(
      'SELECT * FROM health_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      userId, date
    );
    const water = (existing?.water_ml ?? 0) + (plan.waterMl ?? 0);
    const prevTags = (existing?.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean);
    const tags = [...new Set([...prevTags, ...plan.fuel.tags])].join(',');
    const notes = [existing?.food_notes, ...plan.fuel.notes].filter(Boolean).join('; ');
    if (existing) {
      await tx.run('UPDATE health_logs SET water_ml = ?, tags = ?, food_notes = ? WHERE id = ?', water, tags || null, notes || null, existing.id);
    } else {
      await tx.run(
        'INSERT INTO health_logs (user_id, date, water_ml, fruits, food_notes, tags) VALUES (?, ?, ?, ?, ?, ?)',
        userId, date, water, null, notes || null, tags || null
      );
    }
    if (plan.waterMl) applied.push({ table: 'health_logs', label: 'Hydration', detail: `+${plan.waterMl} ml (today: ${water} ml)` });
    if (plan.fuel.notes.length > 0) applied.push({ table: 'health_logs', label: 'Fuel', detail: `${plan.fuel.notes.join('; ')}${plan.fuel.tags.length ? ' · ' + plan.fuel.tags.join(', ') : ''}` });
  }

  if (plan.mood) {
    const existing = await tx.get<any>('SELECT id FROM moods WHERE user_id = ? AND date = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId, date);
    if (existing) {
      await tx.run('UPDATE moods SET score = ?, note = COALESCE(?, note) WHERE id = ?', plan.mood.score, plan.mood.note ?? null, existing.id);
    } else {
      await tx.run('INSERT INTO moods (user_id, date, score, note) VALUES (?, ?, ?, ?)', userId, date, plan.mood.score, plan.mood.note ?? null);
    }
    const labels: Record<number, string> = { 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };
    applied.push({ table: 'moods', label: 'Mood', detail: `${plan.mood.score}/5 · ${labels[plan.mood.score]}` });
  }

  for (const log of plan.timeLogs) {
    await tx.run(
      'INSERT INTO time_logs (user_id, date, category, minutes, note) VALUES (?, ?, ?, ?, ?)',
      userId, date, log.category, log.minutes, log.note
    );
    applied.push({ table: 'time_logs', label: 'Time', detail: `${log.minutes}m ${log.category.replace('_', ' ')}` });
  }

  for (const title of plan.completedTasks) {
    const match = await findOpenTask(tx, userId, title);
    if (match) {
      await tx.run(
        "UPDATE tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP, date = ?, pool = 'today' WHERE id = ? AND user_id = ?",
        date, match.id, userId
      );
      applied.push({ table: 'tasks', label: 'Task completed', detail: match.title });
    } else {
      await tx.run(
        "INSERT INTO tasks (user_id, title, priority, date, status, completed_at, pool) VALUES (?, ?, 'medium', ?, 'completed', CURRENT_TIMESTAMP, 'today')",
        userId, title, date
      );
      applied.push({ table: 'tasks', label: 'Task logged as done', detail: title });
    }
  }

  for (const h of plan.hurdles) {
    let task = await findOpenTask(tx, userId, h.subject);
    if (!task) {
      const result = await tx.run(
        "INSERT INTO tasks (user_id, title, priority, date, status, pool, energy_tag) VALUES (?, ?, 'high', ?, 'needs_attention', 'today', 'deep')",
        userId, h.subject, date
      );
      task = { id: result.lastInsertRowid, title: h.subject };
    } else {
      await tx.run("UPDATE tasks SET status = 'needs_attention' WHERE id = ? AND user_id = ?", task.id, userId);
    }
    await tx.run('INSERT INTO hurdles (user_id, task_id, description) VALUES (?, ?, ?)', userId, task.id, h.description);
    applied.push({ table: 'hurdles', label: 'Hurdle flagged', detail: `${task.title}` });
  }

  for (const t of plan.newTasks) {
    await tx.run(
      "INSERT INTO tasks (user_id, title, priority, date, pool) VALUES (?, ?, ?, ?, 'today')",
      userId, t.title, t.priority, date
    );
    applied.push({ table: 'tasks', label: 'Task added', detail: `${t.title} · ${t.priority}` });
  }

  if (plan.journal.length > 0) {
    const existing = await tx.get<any>('SELECT content FROM journal_entries WHERE user_id = ? AND date = ?', userId, date);
    const note = `${nowLabel()}\n${plan.journal.join('\n')}`;
    const content = existing?.content ? `${existing.content}\n\n${note}` : note;
    await tx.run(
      `INSERT INTO journal_entries (user_id, date, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, date) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP`,
      userId, date, content
    );
    applied.push({ table: 'journal_entries', label: 'Journal', detail: plan.journal.join(' / ') });
  }

  return applied;
}
