export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'ongoing' | 'completed' | 'needs_attention';
export type TaskPool = 'today' | 'scheduled' | 'someday' | 'dropped';
export type EnergyTag = 'deep' | 'admin' | 'quick' | 'recovery';
export type HabitTier = 'bronze' | 'silver' | 'gold';
export type TimeCategory = 'deep_work' | 'admin' | 'learning' | 'exercise' | 'social' | 'rested' | 'cooking' | 'eating' | 'wasted';

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  date: string;
  created_at: string;
  completed_at: string | null;
  energy_tag: EnergyTag;
  pool: TaskPool;
  scheduled_for: string | null;
  parent_task_id: number | null;
}

export interface Hurdle {
  id: number;
  task_id: number;
  description: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  task_title?: string;
}

export interface Capacity {
  score: number | null;
  level: 'unknown' | 'recovery' | 'steady' | 'peak';
  mvdRecommended: boolean;
  signals: { sleep: boolean; mood: boolean; water: boolean };
  parts: { sleep: number | null; mood: number | null; water: number | null };
  headline: string;
}

export interface Insight {
  id: string;
  kind: 'split' | 'correlation' | 'weekday';
  title: string;
  detail: string;
  n: number;
  confidence: 'early' | 'solid';
  effect: number;
}

export interface HabitSummaryItem {
  id: number;
  name: string;
  icon: string;
  completed: boolean;
  tier: HabitTier | null;
  currentStreak: number;
  shields: number;
  consistency14: number;
}

export interface SummaryData {
  date: string;
  tasks: { total: number; completed: number; ongoing: number; needsAttention: number; overdue: number; productivityScore: number; items: Task[] };
  hurdles: Hurdle[];
  time: { byCategory: Partial<Record<TimeCategory, number>>; totalMinutes: number };
  health: { totalWater: number; waterGoalPercent: number; foodNotes: string[]; fruits: string[]; tags: string[]; healthScore: number };
  body: { totalSleepMinutes: number; sleepHours: number; sleepPercent: number; peeCount: number };
  mood: { score: number; note: string | null } | null;
  habits: { total: number; completed: number; pct: number; items: HabitSummaryItem[] };
  capacity: Capacity;
  journal: { hasEntry: boolean; noteCount: number; updatedAt: string | null };
  insight: Insight | null;
  insightCount: number;
  loggedDays30: number;
  tomorrow: { date: string; count: number; items: Array<{ id: number; title: string; priority: Priority; energy_tag: EnergyTag; description: string | null }> };
  lookback: Array<{ label: string; date: string; mood: number | null; journal: string | null; tasksCompleted: number }>;
}

export type ExperimentCause = 'habit' | 'time' | 'tag';
export type ExperimentEffect = 'mood' | 'productivity' | 'sleep' | 'deep_work';

export interface ExperimentResult {
  daysElapsed: number;
  daysTotal: number;
  endDate: string;
  withN: number;
  withoutN: number;
  withMean: number | null;
  withoutMean: number | null;
  diff: number | null;
  unit: string;
  verdict: 'collecting' | 'supported' | 'not_supported' | 'no_difference' | 'inconclusive';
  summary: string;
  causeLabel: string;
  effectLabel: string;
}

export interface Experiment {
  id: number;
  title: string;
  cause_kind: ExperimentCause;
  cause_ref: string;
  cause_min: number;
  effect: ExperimentEffect;
  start_date: string;
  days: number;
  status: string;
  result: ExperimentResult;
}

export interface ExperimentSuggestion {
  title: string;
  cause_kind: ExperimentCause;
  cause_ref: string;
  cause_min: number;
  effect: ExperimentEffect;
  days: number;
}

export interface PixelsData {
  start: string;
  end: string;
  loggedDays: number;
  days: Array<{ date: string; mood: number | null; productivity: number | null; logged: boolean }>;
}

export interface HabitWithStreak {
  id: number;
  name: string;
  icon: string;
  floor_label: string | null;
  target_label: string | null;
  stretch_label: string | null;
  grace_shields: number;
  completed: boolean;
  tier: HabitTier | null;
  currentStreak: number;
  longestStreak: number;
  shields: number;
  totalKept: number;
  consistency14: number;
  history14: Array<{ date: string; tier: HabitTier | null }>;
}

export interface DayPoint {
  date: string;
  weekday: number;
  tasksTotal: number;
  tasksCompleted: number;
  productivity: number | null;
  sleepMinutes: number | null;
  waterMl: number;
  mood: number | null;
  habitsPct: number | null;
  deepWorkMin: number;
  wastedMin: number;
  exerciseMin: number;
  hurdles: number;
  journaled: boolean;
  logged: boolean;
}

export interface RangeData {
  start: string;
  end: string;
  days: DayPoint[];
  totals: {
    daysInRange: number; daysLogged: number; tasksTotal: number; tasksCompleted: number;
    avgProductivity: number | null; avgSleepMinutes: number | null; avgMood: number | null; avgWaterMl: number | null;
    deepWorkMinutes: number; exerciseMinutes: number; wastedMinutes: number; hurdles: number; journalDays: number; strongDays: number;
  };
  habitStats: Array<{ id: number; name: string; icon: string; kept: number; possible: number }>;
  activeHabits: number;
  insights: Insight[];
  wrap: {
    wins: string[];
    bestDay: { date: string; productivity: number | null } | null;
    bestHabit: { name: string; icon: string; kept: number; possible: number } | null;
    topInsight: Insight | null;
    hurdles: number;
    focus: string;
  };
}

export interface OmniPlan {
  sleep?: { start: string; end: string; minutes: number; source: string };
  waterMl?: number;
  mood?: { score: number; note?: string };
  timeLogs: Array<{ category: TimeCategory; minutes: number; note: string }>;
  completedTasks: string[];
  newTasks: Array<{ title: string; priority: Priority }>;
  hurdles: Array<{ subject: string; description: string }>;
  fuel: { tags: string[]; notes: string[] };
  journal: string[];
  unparsed: string[];
}

export interface OmniResult {
  plan: OmniPlan;
  applied: Array<{ table: string; label: string; detail: string }>;
}

export const TIME_CATEGORY_META: Record<TimeCategory, { label: string; icon: string; color: string }> = {
  deep_work: { label: 'Deep work', icon: '🎯', color: '#59c3ff' },
  learning: { label: 'Learning', icon: '📚', color: '#a78bfa' },
  admin: { label: 'Admin & meetings', icon: '🗂', color: '#8ab7d7' },
  exercise: { label: 'Movement', icon: '🏃', color: '#7ce2b6' },
  social: { label: 'Social', icon: '🫶', color: '#ff9b6b' },
  rested: { label: 'Rest', icon: '🌙', color: '#aa66ff' },
  cooking: { label: 'Cooking', icon: '🍳', color: '#ffbf9d' },
  eating: { label: 'Eating', icon: '🍽', color: '#98f2cb' },
  wasted: { label: 'Scrolling / wasted', icon: '📵', color: '#ff6961' },
};

export const PRIORITY_META: Record<Priority, { color: string; bg: string; label: string }> = {
  urgent: { color: '#ff6961', bg: 'rgba(255, 105, 97, 0.12)', label: 'Urgent' },
  high: { color: '#ff9b6b', bg: 'rgba(255, 155, 107, 0.12)', label: 'High' },
  medium: { color: '#59c3ff', bg: 'rgba(89, 195, 255, 0.12)', label: 'Medium' },
  low: { color: '#8ab7d7', bg: 'rgba(138, 183, 215, 0.1)', label: 'Low' },
};

export const ENERGY_META: Record<EnergyTag, { label: string; icon: string }> = {
  deep: { label: 'Deep', icon: '🧠' },
  admin: { label: 'Admin', icon: '🗂' },
  quick: { label: 'Quick', icon: '⚡' },
  recovery: { label: 'Recovery', icon: '🌿' },
};
