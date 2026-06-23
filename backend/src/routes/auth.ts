import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db, { withTransaction } from '../database';
import { requireAuth } from '../middleware/requireAuth';
import { setSessionCookie, clearSessionCookie, signSession } from '../auth-utils';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CLAIMABLE_TABLES = [
  'tasks', 'hurdles', 'time_logs', 'health_logs', 'body_logs',
  'moods', 'habits', 'habit_logs', 'journal_entries', 'streaks', 'groceries',
];

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
}

function toProfile(user: UserRow) {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

router.post('/signup', async (req: Request, res: Response) => {
  const { email, password, displayName } = req.body;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const user = await withTransaction(async (tx) => {
    const isFirstUser = (await tx.get<{ c: number }>('SELECT COUNT(*) as c FROM users'))!.c === 0;

    const result = await tx.run(
      'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
      normalizedEmail, passwordHash, displayName ? String(displayName).trim() : null
    );
    const newUserId = result.lastInsertRowid!;

    if (isFirstUser) {
      for (const table of CLAIMABLE_TABLES) {
        await tx.run(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`, newUserId);
      }
    }

    return (await tx.get<UserRow>('SELECT * FROM users WHERE id = ?', newUserId))!;
  });

  const token = signSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json(toProfile(user));
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.get<UserRow>('SELECT * FROM users WHERE email = ?', normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signSession(user.id);
  setSessionCookie(res, token);
  res.json(toProfile(user));
});

router.post('/logout', async (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(204).send();
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(toProfile(user));
});

router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const { displayName, email } = req.body;

  let normalizedEmail: string | null = null;
  if (email !== undefined) {
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    normalizedEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', normalizedEmail, req.userId);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
  }

  await db.run(
    'UPDATE users SET display_name = COALESCE(?, display_name), email = COALESCE(?, email) WHERE id = ?',
    displayName !== undefined ? String(displayName).trim() : null, normalizedEmail, req.userId
  );

  const user = (await db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.userId))!;
  res.json(toProfile(user));
});

router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = (await db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.userId))!;
  if (typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', newHash, req.userId);
  res.status(204).send();
});

router.delete('/me', requireAuth, async (req: Request, res: Response) => {
  const { password } = req.body;
  const user = (await db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.userId))!;
  if (typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Password is incorrect' });
  }

  await db.run('DELETE FROM users WHERE id = ?', req.userId);
  clearSessionCookie(res);
  res.status(204).send();
});

export default router;
