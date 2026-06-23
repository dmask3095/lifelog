import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';

const JWT_SECRET: string = process.env.JWT_SECRET ?? (() => {
  throw new Error('JWT_SECRET environment variable is required');
})();

export const SESSION_COOKIE = 'lifelog_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as CookieOptions['sameSite'];
// Browsers reject SameSite=None without Secure, so force it on rather than ship a
// cookie that silently never gets set on a cross-site deployment.
const secure = sameSite === 'none' || process.env.COOKIE_SECURE === 'true';

export function signSession(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifySession(token: string): number | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === 'object' && decoded && typeof decoded.userId === 'number') {
      return decoded.userId;
    }
    return null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite,
    secure,
  });
}
