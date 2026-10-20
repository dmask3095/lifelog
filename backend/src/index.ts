import app from './app';
import { dbReady } from './database';
import { startPushScheduler } from './lib/push';

const PORT = Number(process.env.PORT) || 3001;

dbReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    if (process.env.PUSH_SCHEDULER !== 'off') startPushScheduler();
  })
  .catch((err) => {
    console.error('Failed to set up database:', err);
    process.exit(1);
  });
