import { createClient } from '@libsql/client';
import path from 'path';

const databaseUrl = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '../lifelog.db')}`;
const isLocalFile = databaseUrl.startsWith('file:');

const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export interface DbHandle {
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  run(sql: string, ...params: any[]): Promise<{ lastInsertRowid: number | undefined; changes: number }>;
}

type Executor = (stmt: { sql: string; args: any[] }) => Promise<{
  rows: any[];
  rowsAffected: number;
  lastInsertRowid: bigint | undefined;
}>;

function wrap(executor: Executor): DbHandle {
  return {
    async get(sql, ...params) {
      const rs = await executor({ sql, args: params });
      return rs.rows[0] as any;
    },
    async all(sql, ...params) {
      const rs = await executor({ sql, args: params });
      return rs.rows as any[];
    },
    async run(sql, ...params) {
      const rs = await executor({ sql, args: params });
      return {
        lastInsertRowid: rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : undefined,
        changes: rs.rowsAffected,
      };
    },
  };
}

const db: DbHandle = wrap((stmt) => client.execute(stmt));

// Runs fn against a single interactive transaction; commits on success, rolls back on throw.
export async function withTransaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
  const tx = await client.transaction('write');
  try {
    const result = await fn(wrap((stmt) => tx.execute(stmt)));
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
}

const TABLE_SCHEMAS: Record<string, string> = {
  tasks: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','ongoing','completed','needs_attention')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
    date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  `,
  hurdles: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  time_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('wasted','rested','cooking','eating')),
    minutes INTEGER NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  health_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    water_ml INTEGER DEFAULT 0,
    fruits TEXT,
    food_notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  body_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('sleep','pee')),
    time TEXT,
    duration_minutes INTEGER,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  moods: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  habits: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '✓',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
  habit_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(habit_id, date)
  `,
  journal_entries: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
  `,
  streaks: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_logged_date TEXT,
    UNIQUE(user_id, metric)
  `,
  groceries: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('dairy','vegetable','fruit','protein','pantry','cake','sweet','leftover','other')),
    quantity REAL,
    unit TEXT,
    storage TEXT NOT NULL DEFAULT 'fridge' CHECK(storage IN ('fridge','freezer','pantry','counter','unknown')),
    status TEXT NOT NULL DEFAULT 'stocked' CHECK(status IN ('stocked','cook_soon','eat_asap','cooked','finished')),
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  `,
};

// Parents must be rebuilt before children: renaming a table mid-rebuild rewrites any
// other table's FK clause that references it by name (e.g. hurdles.task_id), so a
// child must only be rebuilt once its parent has settled back into its final name.
const ALL_TABLES = [
  'tasks', 'habits', 'hurdles', 'habit_logs',
  'time_logs', 'health_logs', 'body_logs', 'moods', 'groceries',
  'journal_entries', 'streaks',
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((c) => c.name === column);
}

async function userIdCascadeAction(table: string): Promise<string | null> {
  const fks = await db.all<{ from: string; on_delete: string }>(`PRAGMA foreign_key_list(${table})`);
  return fks.find((fk) => fk.from === 'user_id')?.on_delete ?? null;
}

// Full rebuild (rename -> create canonical schema -> copy -> drop) used both to add a
// missing user_id column when ALTER TABLE can't express the needed constraint change,
// and to repair a user_id foreign key that's missing ON DELETE CASCADE. Dev-only (see
// setupDatabase below) — production Turso is seeded pre-migrated via direct file import.
async function rebuildWithCanonicalSchema(table: string) {
  const oldColumns = (await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
  const sharedColumns = oldColumns.filter((c) => c !== 'user_id').join(', ');
  const hadUserId = oldColumns.includes('user_id');
  await db.run(`ALTER TABLE ${table} RENAME TO ${table}_old`);
  await db.run(`CREATE TABLE ${table} (${TABLE_SCHEMAS[table]})`);
  await db.run(`
    INSERT INTO ${table} (${hadUserId ? 'user_id, ' : ''}${sharedColumns})
      SELECT ${hadUserId ? 'user_id, ' : ''}${sharedColumns} FROM ${table}_old
  `);
  await db.run(`DROP TABLE ${table}_old`);
}

async function setupDatabase() {
  await db.run('PRAGMA foreign_keys = ON');

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    ${ALL_TABLES.map((table) => `CREATE TABLE IF NOT EXISTS ${table} (${TABLE_SCHEMAS[table]});`).join('\n')}
  `);

  // The ALTER-TABLE repair/rebuild dance below is a dev-only safety net for the local
  // lifelog.db file (which predates the users table). Production Turso is seeded by
  // importing that same file once it's already fully migrated, so this never needs to
  // run there — and some PRAGMAs used here are not reliably supported over Turso's
  // remote protocol, so skipping it in production avoids a startup crash risk.
  if (!isLocalFile) return;

  // Rebuilding a referenced table (tasks/habits) rewrites any other table's FK clause
  // that names it, which can otherwise cascade-delete children when the old copy is
  // dropped. Disabling enforcement for the duration of the rebuild avoids that.
  await db.run('PRAGMA foreign_keys = OFF');
  try {
    for (const table of ALL_TABLES) {
      if (!(await hasColumn(table, 'user_id'))) {
        // journal_entries/streaks also need their UNIQUE constraint to become
        // composite (user_id, date|metric), which ALTER TABLE ADD COLUMN can't express.
        if (table === 'journal_entries' || table === 'streaks') {
          await rebuildWithCanonicalSchema(table);
        } else {
          await db.run(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
        }
      } else if ((await userIdCascadeAction(table)) !== 'CASCADE') {
        // Repairs databases migrated by an earlier version of this script that added
        // user_id without ON DELETE CASCADE, which broke account deletion.
        await rebuildWithCanonicalSchema(table);
      }
    }

    for (const table of ALL_TABLES) {
      await db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`);
    }
  } finally {
    await db.run('PRAGMA foreign_keys = ON');
  }

  const fkIssues = await db.all('PRAGMA foreign_key_check');
  if (fkIssues.length > 0) {
    console.warn('Foreign key check found issues after migration:', fkIssues);
  }
}

export const dbReady = setupDatabase();

export default db;
