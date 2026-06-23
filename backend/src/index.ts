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

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

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
app.use('/api/groceries', groceryRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'LifeLog API is running', timestamp: new Date().toISOString() });
});

dbReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to set up database:', err);
    process.exit(1);
  });
