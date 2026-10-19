import webpush from 'web-push';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../database';

// Derive a stable P-256 key pair from the server secret so VAPID keys survive redeploys on
// hosts with ephemeral disks (Render) without adding new environment variables.
function deriveVapidFromSecret(secret: string): { publicKey: string; privateKey: string } | null {
  try {
    const scalar = Buffer.from(crypto.hkdfSync('sha256', secret, 'lifelog-vapid-salt', 'lifelog web push vapid v1', 32));
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(scalar); // throws if the scalar is not a valid private key (vanishingly rare)
    return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: scalar.toString('base64url') };
  } catch {
    return null;
  }
}

// VAPID keys come from the environment in production. For local development a key pair is
// generated once and cached in backend/.vapid.json (gitignored) so subscriptions stay valid
// across restarts.
let configured = false;
let publicKey = '';

export function ensureVapid(): string {
  if (configured) return publicKey;
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  const cache = path.join(__dirname, '../../.vapid.json');
  if ((!pub || !priv) && process.env.JWT_SECRET) {
    const derived = deriveVapidFromSecret(process.env.JWT_SECRET);
    if (derived) {
      pub = derived.publicKey;
      priv = derived.privateKey;
    }
  }
  if (!pub || !priv) {
    if (fs.existsSync(cache)) {
      const saved = JSON.parse(fs.readFileSync(cache, 'utf8'));
      pub = saved.publicKey;
      priv = saved.privateKey;
    } else {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      fs.writeFileSync(cache, JSON.stringify({ publicKey: pub, privateKey: priv }, null, 2));
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@lifelog.app', pub as string, priv as string);
  publicKey = pub as string;
  configured = true;
  return publicKey;
}

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

export async function sendToSubscription(sub: { id: number; endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<boolean> {
  ensureVapid();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (err: any) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', sub.id); // subscription expired
    } else {
      console.warn('web-push failed', status, err?.body ?? err?.message);
    }
    return false;
  }
}

export async function sendToUser(userId: number, payload: PushPayload): Promise<number> {
  const subs = await db.all<any>('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  let ok = 0;
  for (const s of subs) if (await sendToSubscription(s, payload)) ok++;
  return ok;
}

function localDateParts(nowUtcMs: number, tzOffsetMinutes: number) {
  const local = new Date(nowUtcMs + tzOffsetMinutes * 60_000);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

// Evening "close your day" reminder. Checks once a minute; each subscription fires at its own
// local time at most once per local day. tz_offset_minutes is what the browser reported.
export function startPushScheduler() {
  ensureVapid();
  const tick = async () => {
    try {
      const subs = await db.all<any>('SELECT * FROM push_subscriptions');
      const now = Date.now();
      for (const s of subs) {
        const { date, minutes } = localDateParts(now, Number(s.tz_offset_minutes) || 0);
        const target = Number(s.reminder_hour) * 60 + Number(s.reminder_minute);
        if (s.last_sent_date === date || minutes < target || minutes > target + 90) continue;
        await db.run('UPDATE push_subscriptions SET last_sent_date = ? WHERE id = ?', date, s.id);
        await sendToSubscription(s, {
          title: 'Close your day',
          body: 'Mood, one win, tomorrow’s top task. 60 seconds, then rest.',
          url: '/?close=1',
          tag: 'lifelog-close-day',
        });
      }
    } catch (err) {
      console.warn('push scheduler tick failed', err);
    }
  };
  setInterval(tick, 60_000).unref();
  void tick();
}
