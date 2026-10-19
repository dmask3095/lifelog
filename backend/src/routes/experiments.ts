import { Router, Request, Response } from 'express';
import db, { EXPERIMENT_CAUSES, EXPERIMENT_EFFECTS, TIME_CATEGORIES } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { evaluateExperiment, expectsLower, type ExperimentRow } from '../lib/experiments';
import { isIsoDate } from '../lib/dates';

const router = Router();
router.use(requireAuth);

const EFFECT_WORDS: Record<string, string> = { mood: 'my mood', productivity: 'my task completion', sleep: 'my sleep', deep_work: 'my deep work' };

async function buildTitle(userId: number, cause_kind: string, cause_ref: string, cause_min: number, effect: string): Promise<string> {
  let cause = cause_ref;
  if (cause_kind === 'habit') {
    const h = await db.get<any>('SELECT name FROM habits WHERE id = ? AND user_id = ?', cause_ref, userId);
    cause = h ? `I keep “${h.name}”` : 'I keep this habit';
  } else if (cause_kind === 'time') cause = `I log ${cause_min}m+ of ${cause_ref.replace('_', ' ')}`;
  else cause = `my day has ${cause_ref}`;
  const worse = expectsLower({ cause_kind: cause_kind as ExperimentRow['cause_kind'], cause_ref });
  return `When ${cause}, is ${EFFECT_WORDS[effect] ?? effect} ${worse ? 'worse' : 'better'}?`;
}

// GET /api/experiments?today=YYYY-MM-DD
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const today = isIsoDate(req.query.today) ? String(req.query.today) : new Date().toISOString().slice(0, 10);
  const rows = await db.all<ExperimentRow>("SELECT * FROM experiments WHERE user_id = ? AND status != 'archived' ORDER BY created_at DESC", userId);
  const out = [];
  for (const exp of rows) out.push({ ...exp, result: await evaluateExperiment(db, exp, today) });
  res.json(out);
});

// GET /api/experiments/suggestions — hunches worth testing, built from the user's own setup.
router.get('/suggestions', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const habits = await db.all<any>('SELECT id, name, icon FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 4', userId);
  const suggestions: Array<{ title: string; cause_kind: string; cause_ref: string; cause_min: number; effect: string; days: number }> = [];
  for (const h of habits.slice(0, 2)) suggestions.push({ title: `Does ${h.icon} ${h.name} lift my mood?`, cause_kind: 'habit', cause_ref: String(h.id), cause_min: 0, effect: 'mood', days: 14 });
  suggestions.push({ title: 'Does 60m+ of deep work make for better days?', cause_kind: 'time', cause_ref: 'deep_work', cause_min: 60, effect: 'mood', days: 14 });
  suggestions.push({ title: 'Does 20m+ of movement raise my task completion?', cause_kind: 'time', cause_ref: 'exercise', cause_min: 20, effect: 'productivity', days: 14 });
  suggestions.push({ title: 'Does caffeine hurt my sleep the next night?', cause_kind: 'tag', cause_ref: 'caffeine', cause_min: 0, effect: 'sleep', days: 21 });
  suggestions.push({ title: 'Does 60m+ of scrolling drag my mood down?', cause_kind: 'time', cause_ref: 'wasted', cause_min: 60, effect: 'mood', days: 14 });
  res.json(suggestions);
});

router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { title, cause_kind, cause_ref, cause_min, effect, start_date, days } = req.body;
  if (!(EXPERIMENT_CAUSES as readonly string[]).includes(cause_kind)) return res.status(400).json({ error: 'cause_kind must be habit, time or tag' });
  if (!(EXPERIMENT_EFFECTS as readonly string[]).includes(effect)) return res.status(400).json({ error: 'invalid effect' });
  if (cause_kind === 'time' && !(TIME_CATEGORIES as readonly string[]).includes(cause_ref)) return res.status(400).json({ error: 'invalid time category' });
  if (cause_kind === 'habit') {
    const h = await db.get('SELECT id FROM habits WHERE id = ? AND user_id = ?', cause_ref, userId);
    if (!h) return res.status(404).json({ error: 'habit not found' });
  }
  if (!isIsoDate(start_date)) return res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
  const n = Number(days) || 14;
  if (n < 7 || n > 60) return res.status(400).json({ error: 'days must be 7-60' });
  const minutes = Math.max(0, Number(cause_min) || 0);
  const finalTitle = title && String(title).trim() ? String(title).trim() : await buildTitle(userId, cause_kind, String(cause_ref), minutes, effect);
  const result = await db.run(
    'INSERT INTO experiments (user_id, title, cause_kind, cause_ref, cause_min, effect, start_date, days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId, finalTitle, cause_kind, String(cause_ref), minutes, effect, start_date, n
  );
  const exp = await db.get<ExperimentRow>('SELECT * FROM experiments WHERE id = ?', result.lastInsertRowid);
  res.status(201).json({ ...exp, result: await evaluateExperiment(db, exp!, start_date) });
});

router.patch('/:id', async (req: Request, res: Response) => {
  const exp = await db.get<ExperimentRow>('SELECT * FROM experiments WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  const status = req.body.status === 'archived' ? 'archived' : req.body.status === 'done' ? 'done' : 'running';
  await db.run('UPDATE experiments SET status = ? WHERE id = ?', status, exp.id);
  res.json(await db.get('SELECT * FROM experiments WHERE id = ?', exp.id));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await db.run('DELETE FROM experiments WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  res.status(204).send();
});

export default router;
