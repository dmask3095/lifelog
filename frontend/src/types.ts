export interface TaskItem {
  id: number;
  title: string;
  status: 'pending' | 'ongoing' | 'completed' | 'needs_attention';
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface GroceryOverviewItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
}

export type GroceryCategory = 'tracked' | 'eatAsap' | 'cookSoon' | 'cooked';

export interface SummaryData {
  date: string;
  tasks: { total: number; completed: number; ongoing: number; needsAttention: number; productivityScore: number; items: TaskItem[] };
  hurdles: any[];
  time: { byCategory: Record<string, number>; totalMinutes: number };
  health: { totalWater: number; waterGoalPercent: number; foodNotes: string[]; fruits: string[]; healthScore: number };
  body: { totalSleepMinutes: number; sleepHours: number; peeCount: number };
  groceries: {
    total: number;
    eatAsapCount: number;
    cookSoonCount: number;
    cookedCount: number;
    eatAsapItems: Array<{ id: number; name: string; notes: string | null }>;
    mealIdeas: Array<{ title: string; why: string; uses: string[] }>;
    byCategory: Record<GroceryCategory, GroceryOverviewItem[]>;
  };
}
