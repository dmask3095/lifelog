import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { dbReady } from './database';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import hurdleRoutes from './routes/hurdles';
import timeLogRoutes from './routes/time-logs';
import healthLogRoutes from './routes/health-logs';
import bodyLogRoutes from './routes/body-logs';
import summaryRoutes from './routes/summary';
import moodRoutes from './routes/moods';
import habitRoutes from './routes/habits';
import journalRoutes from './routes/journal';
import groceryRoutes from './routes/groceries';
import omniRoutes from './routes/omni';
import exportRoutes from './routes/export';
import dayPlanRoutes from './routes/day-plans';
import experimentRoutes from './routes/experiments';
import pushRoutes from './routes/push';
import { runPushReminderTick } from './lib/push';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Ensure schema & additive migrations are ready before serving requests (required for Vercel Serverless).
app.use(async (_req, _res, next) => {
  try {
    await dbReady;
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/hurdles', hurdleRoutes);
app.use('/api/time-logs', timeLogRoutes);
app.use('/api/health-logs', healthLogRoutes);
app.use('/api/body-logs', bodyLogRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/moods', moodRoutes);
app.use('/api/habits', habitRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/groceries', groceryRoutes); // retired from the UI in v2, kept for data access
app.use('/api/omni-log', omniRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/day-plans', dayPlanRoutes);
app.use('/api/experiments', experimentRoutes);
app.use('/api/push', pushRoutes);

const healthHandler = (_req: express.Request, res: express.Response) => {
  if (process.env.PUSH_SCHEDULER !== 'off') void runPushReminderTick();
  res.json({ status: 'LifeLog API 2.1 is running', timestamp: new Date().toISOString() });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

export default app;
