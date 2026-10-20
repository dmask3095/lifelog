import { Router, Request, Response } from 'express';
import db from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { ensureVapid, runPushReminderTick, sendToUser } from '../lib/push';

const router = Router();

router.get('/vapid', (_req: Request, res: Response) => {
  res.json({ publicKey: ensureVapid() });
});

// Public, idempotent cron endpoint for Vercel Serverless Cron or external keep-alive pingers.
router.all('/cron', async (_req: Request, res: Response) => {
  const result = await runPushReminderTick();
  res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
});

router.use(requireAuth);

router.get('/status', async (req: Request, res: Response) => {
  const subs = await db.all<any>('SELECT id, endpoint, reminder_hour, reminder_minute, tz_offset_minutes, last_sent_date, created_at FROM push_subscriptions WHERE user_id = ?', req.userId);
  res.json(subs.map((s: any) => ({ ...s, endpoint: String(s.endpoint).slice(0, 40) + '…' })));
});

router.post('/subscribe', async (req: Request, res: Response) => {
  const userId = req.userId as number;
  const { subscription, reminderHour, reminderMinute, tzOffsetMinutes } = req.body ?? {};
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return res.status(400).json({ error: 'a push subscription with endpoint and keys is required' });
  }
  const hour = Math.min(23, Math.max(0, Number(reminderHour ?? 20) || 0));
  const minute = Math.min(59, Math.max(0, Number(reminderMinute ?? 30) || 0));
  const tz = Math.max(-840, Math.min(840, Number(tzOffsetMinutes ?? 0) || 0));
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, reminder_hour, reminder_minute, tz_offset_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       reminder_hour = excluded.reminder_hour, reminder_minute = excluded.reminder_minute, tz_offset_minutes = excluded.tz_offset_minutes`,
    userId, endpoint, p256dh, auth, hour, minute, tz
  );
  res.status(201).json({ ok: true, reminderHour: hour, reminderMinute: minute });
});

router.delete('/subscribe', async (req: Request, res: Response) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === 'string') await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.userId, endpoint);
  else await db.run('DELETE FROM push_subscriptions WHERE user_id = ?', req.userId);
  res.status(204).send();
});

router.post('/test', async (req: Request, res: Response) => {
  const sent = await sendToUser(req.userId as number, { title: 'LifeLog reminders are on', body: 'This is what the evening nudge will look like.', url: '/' });
  res.json({ sent });
});

export default router;
