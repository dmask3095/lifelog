import { Request, Response, NextFunction } from 'express';
import { SESSION_COOKIE, verifySession } from '../auth-utils';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = token ? verifySession(token) : null;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.userId = userId;
  next();
}
