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

// ---------------------------------------------------------------------------
// v2 vocabularies (shared by routes, the Omni-Bar parser and the frontend)
// ---------------------------------------------------------------------------
export const TIME_CATEGORIES = [
  'deep_work', 'admin', 'learning', 'exercise', 'social', 'rested', 'cooking', 'eating', 'wasted',
] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

export const TASK_POOLS = ['today', 'scheduled', 'someday', 'dropped'] as const;
export type TaskPool = (typeof TASK_POOLS)[number];

export const ENERGY_TAGS = ['deep', 'admin', 'quick', 'recovery'] as const;
export type EnergyTag = (typeof ENERGY_TAGS)[number];

export const HABIT_TIERS = ['bronze', 'silver', 'gold'] as const;
export type HabitTier = (typeof HABIT_TIERS)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TASK_STATUSES = ['pending', 'ongoing', 'completed', 'needs_attention'] as const;

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
    completed_at TEXT,
    energy_tag TEXT DEFAULT 'quick',
    pool TEXT NOT NULL DEFAULT 'today' CHECK(pool IN ('today','scheduled','someday','dropped')),
    scheduled_for TEXT,
    parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE
  `,
  hurdles: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    resolution TEXT
  `,
  time_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('deep_work','admin','learning','exercise','social','rested','cooking','eating','wasted')),
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    tags TEXT
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    floor_label TEXT,
    target_label TEXT,
    stretch_label TEXT,
    grace_shields INTEGER DEFAULT 1
  `,
  habit_logs: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    tier TEXT DEFAULT 'silver',
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
  // Retired from the UI in v2 (FreshFlow Pantry owns the kitchen); kept so existing data stays readable.
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

// Additive v2 columns. These run against BOTH the local SQLite file and Turso: they are
// plain `ALTER TABLE ... ADD COLUMN` statements guarded by a sqlite_master read, so no
// PRAGMA is needed over the remote protocol.
const V2_COLUMNS: Record<string, Array<{ name: string; ddl: string }>> = {
  tasks: [
    { name: 'energy_tag', ddl: "energy_tag TEXT DEFAULT 'quick'" },
    { name: 'pool', ddl: "pool TEXT NOT NULL DEFAULT 'today'" },
    { name: 'scheduled_for', ddl: 'scheduled_for TEXT' },
    { name: 'parent_task_id', ddl: 'parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE' },
  ],
  hurdles: [
    { name: 'resolved_at', ddl: 'resolved_at TEXT' },
    { name: 'resolution', ddl: 'resolution TEXT' },
  ],
  health_logs: [{ name: 'tags', ddl: 'tags TEXT' }],
  habits: [
    { name: 'floor_label', ddl: 'floor_label TEXT' },
    { name: 'target_label', ddl: 'target_label TEXT' },
    { name: 'stretch_label', ddl: 'stretch_label TEXT' },
    { name: 'grace_shields', ddl: 'grace_shields INTEGER DEFAULT 1' },
  ],
  habit_logs: [{ name: 'tier', ddl: "tier TEXT DEFAULT 'silver'" }],
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

async function tableSql(table: string): Promise<string> {
  const row = await db.get<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table
  );
  return row?.sql ?? '';
}

function sqlHasColumn(sql: string, column: string): boolean {
  return new RegExp(`[\\s(,]${column}\\s`, 'i').test(sql);
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

// v2: widen the time_logs category vocabulary. The original CHECK only allowed
// ('wasted','rested','cooking','eating'), which made Deep Work, Admin, Exercise, Learning
// and Social impossible to log. Uses plain SQL only, so it also runs on Turso.
async function widenTimeLogCategories() {
  const sql = await tableSql('time_logs');
  if (!sql || sql.includes('deep_work')) return;
  await db.run('ALTER TABLE time_logs RENAME TO time_logs_v1');
  await db.run(`CREATE TABLE time_logs (${TABLE_SCHEMAS.time_logs})`);
  await db.run(`
    INSERT INTO time_logs (id, user_id, date, category, minutes, note, created_at)
      SELECT id, user_id, date, category, minutes, note, created_at FROM time_logs_v1
  `);
  await db.run('DROP TABLE time_logs_v1');
}

async function applyV2Migrations() {
  for (const [table, columns] of Object.entries(V2_COLUMNS)) {
    const sql = await tableSql(table);
    if (!sql) continue;
    for (const column of columns) {
      if (!sqlHasColumn(sql, column.name)) {
        await db.run(`ALTER TABLE ${table} ADD COLUMN ${column.ddl}`);
      }
    }
  }
  await widenTimeLogCategories();
  for (const table of ALL_TABLES) {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_user_id ON ${table}(user_id)`);
  }
  await db.run('CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, date)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_body_logs_user_date ON body_logs(user_id, date)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_health_logs_user_date ON health_logs(user_id, date)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_moods_user_date ON moods(user_id, date)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, date)');
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
  if (isLocalFile) {
    // Rebuilding a referenced table (tasks/habits) rewrites any other table's FK clause
    // that names it, which can otherwise cascade-delete children when the old copy is
    // dropped. Disabling enforcement for the duration of the rebuild avoids that.
    await db.run('PRAGMA foreign_keys = OFF');
    try {
      for (const table of ALL_TABLES) {
        if (!(await hasColumn(table, 'user_id'))) {
          if (table === 'journal_entries' || table === 'streaks') {
            await rebuildWithCanonicalSchema(table);
          } else {
            await db.run(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
          }
        } else if ((await userIdCascadeAction(table)) !== 'CASCADE') {
          await rebuildWithCanonicalSchema(table);
        }
      }
    } finally {
      await db.run('PRAGMA foreign_keys = ON');
    }
  }

  // v2 additive migrations run everywhere (plain SQL, no PRAGMA).
  await applyV2Migrations();

  if (isLocalFile) {
    const fkIssues = await db.all('PRAGMA foreign_key_check');
    if (fkIssues.length > 0) {
      console.warn('Foreign key check found issues after migration:', fkIssues);
    }
  }
}

export const dbReady = setupDatabase();

export default db;
