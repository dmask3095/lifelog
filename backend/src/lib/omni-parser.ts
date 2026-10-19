import { TIME_CATEGORIES, type TimeCategory } from '../database';
import { minutesToClock } from './dates';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

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

const MOOD_WORDS: Record<string, number> = {
  amazing: 5, fantastic: 5, excellent: 5, great: 5, energized: 5, energised: 5, happy: 5,
  good: 4, calm: 4, solid: 4, decent: 4, productive: 4, focused: 4,
  okay: 3, ok: 3, fine: 3, meh: 3, average: 3, 'so-so': 3, neutral: 3, alright: 3,
  low: 2, tired: 2, bad: 2, down: 2, anxious: 2, stressed: 2, drained: 2, flat: 2, foggy: 2,
  rough: 1, terrible: 1, awful: 1, exhausted: 1, miserable: 1, horrible: 1,
};
const MOOD_WORD_RE = new RegExp(`\\b(?:feeling|felt|feel|mood|i'm|im|i am)\\s*(?:is|was|:|like)?\\s*(?:pretty|really|very|a bit|kind of|kinda|quite|so)?\\s*(${Object.keys(MOOD_WORDS).join('|')})\\b`, 'i');

const CATEGORY_WORDS: Array<{ category: TimeCategory; re: RegExp }> = [
  { category: 'deep_work', re: /\b(deep ?work|focus(?:ed)?(?: work| session| time)?|coding|coded|programming|building|writing|debugging|designing|shipping)\b/i },
  { category: 'learning', re: /\b(learning|learned|learnt|reading|read|study(?:ing)?|studied|course|lecture|class|tutorial|practice|practising|practicing)\b/i },
  { category: 'admin', re: /\b(admin|emails?|inbox|meetings?|calls?|standup|planning|chores|errands|paperwork|taxes|invoices?|bills)\b/i },
  { category: 'exercise', re: /\b(workout|worked out|gym|exercise|exercised|run|running|ran|jog|walk(?:ed|ing)?|yoga|lifting|weights|cycling|biked?|swim(?:ming)?|hike|hiking|stretching|pilates)\b/i },
  { category: 'social', re: /\b(social|friends?|family|date night|hangout|hung out|party|dinner with|lunch with|coffee with|catch(?:ing)? up)\b/i },
  { category: 'rested', re: /\b(rest(?:ed|ing)?|nap(?:ped|ping)?|relax(?:ed|ing)?|meditat(?:ed|ion|ing)|chill(?:ed|ing)?|downtime|break)\b/i },
  { category: 'cooking', re: /\b(cooking|cooked|meal prep|baking|baked)\b/i },
  { category: 'eating', re: /\b(eating|ate out|lunch|dinner|breakfast|brunch)\b/i },
  { category: 'wasted', re: /\b(wasted|scroll(?:ed|ing)?|doom ?scroll(?:ed|ing)?|tiktok|instagram|reels|youtube|procrastinat(?:ed|ing|ion)|netflix|binge)\b/i },
];

const PROTEIN_RE = /\b(chicken|eggs?|fish|salmon|tuna|tofu|paneer|dal|daal|lentils?|beans|yogurt|yoghurt|curd|protein|steak|beef|turkey|shrimp|prawns?|chickpeas?|cottage cheese|whey)\b/i;
const PRODUCE_RE = /\b(salad|fruit|fruits|apple|banana|mango|berries|orange|grapes|spinach|kale|broccoli|veg|veggies|vegetables|carrots?|avocado|tomato|cucumber|greens|smoothie|papaya|pomegranate)\b/i;
const CAFFEINE_RE = /\b(coffee|espresso|latte|cappuccino|americano|chai|tea|matcha|energy drink|red bull|monster|cold brew)\b/i;
const SUGAR_RE = /\b(cake|dessert|cookies?|ice cream|chocolate|candy|donut|doughnut|soda|coke|pastry|sweets?|brownie)\b/i;
const ALCOHOL_RE = /\b(beer|wine|cocktail|whisky|whiskey|vodka|drinks? out|alcohol)\b/i;
const FUEL_START_RE = /^(?:ate|had|eat|eating|drank|drink|lunch|dinner|breakfast|snack|snacked|brunch)\b/i;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function parseClock(raw: string, assume: 'evening' | 'morning'): number | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3] ? m[3][0] : null;
  if (h > 24 || min > 59) return null;
  if (ap) {
    if (h === 12) h = ap === 'a' ? 0 : 12;
    else if (ap === 'p') h += 12;
  } else if (h <= 12) {
    if (assume === 'evening') {
      if (h === 12) h = 0;
      else if (h >= 6) h += 12;
    }
  }
  if (h === 24) h = 0;
  return h * 60 + min;
}

function durationMinutes(clause: string): number | null {
  const hm = clause.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:and\s*)?(\d{1,2})\s*(?:m|min|mins|minutes)?\b/i);
  if (hm && hm[2] !== undefined && /(?:h|hr|hrs|hour|hours)\s*(?:and\s*)?\d/i.test(hm[0])) return Math.round(parseFloat(hm[1]) * 60 + parseInt(hm[2], 10));
  const hOnly = clause.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 60);
  const mOnly = clause.match(/(\d+)\s*(?:m|min|mins|minutes)\b/i);
  if (mOnly) return parseInt(mOnly[1], 10);
  return null;
}

function priorityFrom(text: string): { priority: Priority; cleaned: string } {
  let cleaned = text;
  let priority: Priority = 'medium';
  if (/\b(urgent|asap|critical)\b|!!/i.test(cleaned)) priority = 'urgent';
  else if (/\b(important|high priority|high)\b|!/i.test(cleaned)) priority = 'high';
  else if (/\b(low priority|someday|maybe|low)\b/i.test(cleaned)) priority = 'low';
  cleaned = cleaned.replace(/\b(urgent|asap|critical|important|high priority|low priority|someday|maybe)\b/gi, '').replace(/!+/g, '').replace(/\s{2,}/g, ' ').trim();
  return { priority, cleaned };
}

function tidy(s: string): string {
  return s.replace(/^[\s:,-]+|[\s.,;:!-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

function splitClauses(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n|;|,|\.\s+|\band then\b|\bthen\b|\s\|\s/i)
    .map((c) => c.replace(/^[\s:,-]+|[\s.,;:-]+$/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter((c) => c.length > 0);
}

function fuelTags(clause: string): string[] {
  const tags: string[] = [];
  if (PROTEIN_RE.test(clause)) tags.push('protein');
  if (PRODUCE_RE.test(clause)) tags.push('produce');
  if (CAFFEINE_RE.test(clause)) tags.push('caffeine');
  if (SUGAR_RE.test(clause)) tags.push('sugar');
  if (ALCOHOL_RE.test(clause)) tags.push('alcohol');
  return tags;
}

export function parseOmni(text: string): OmniPlan {
  const plan: OmniPlan = {
    timeLogs: [],
    completedTasks: [],
    newTasks: [],
    hurdles: [],
    fuel: { tags: [], notes: [] },
    journal: [],
    unparsed: [],
  };

  for (const clause of splitClauses(text)) {
    const lower = clause.toLowerCase();

    // ---- sleep (bed → wake) ------------------------------------------------
    const range = clause.match(/\b(?:slept|sleep|bed|asleep)\s*(?:from|at)?\s*([0-9]{1,2}(?:[:.][0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—|until|till|->|→)\s*([0-9]{1,2}(?:[:.][0-9]{2})?\s*(?:am|pm)?)/i)
      || clause.match(/\bbed\s*(?:at)?\s*([0-9]{1,2}(?:[:.][0-9]{2})?\s*(?:am|pm)?).*?\b(?:woke|wake|up)\s*(?:up)?\s*(?:at)?\s*([0-9]{1,2}(?:[:.][0-9]{2})?\s*(?:am|pm)?)/i);
    if (range) {
      const start = parseClock(range[1], 'evening');
      const end = parseClock(range[2], 'morning');
      if (start != null && end != null) {
        let minutes = end - start;
        if (minutes <= 0) minutes += 1440;
        plan.sleep = { start: minutesToClock(start), end: minutesToClock(end), minutes, source: clause };
        continue;
      }
    }
    const sleepDur = clause.match(/\b(?:slept|sleep)\s*(?:for|about|around|~)?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i)
      || clause.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(?:of\s+)?sleep\b/i);
    if (sleepDur) {
      const minutes = Math.round(parseFloat(sleepDur[1]) * 60);
      const end = 7 * 60;
      plan.sleep = { start: minutesToClock(end - minutes), end: minutesToClock(end), minutes, source: clause };
      continue;
    }

    // ---- water -------------------------------------------------------------
    const water = clause.match(/(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|glasses?|cups?|oz|ounces?|bottles?)\b/i);
    if (water && /\b(water|hydrat|drank|drink)\b/i.test(lower) && !CAFFEINE_RE.test(lower)) {
      const amount = parseFloat(water[1]);
      const unit = water[2].toLowerCase();
      let ml = amount;
      if (unit.startsWith('l')) ml = amount * 1000;
      else if (unit.startsWith('glass') || unit.startsWith('cup')) ml = amount * 250;
      else if (unit.startsWith('bottle')) ml = amount * 500;
      else if (unit.startsWith('oz') || unit.startsWith('ounce')) ml = amount * 29.57;
      plan.waterMl = (plan.waterMl ?? 0) + Math.round(ml);
      continue;
    }

    // ---- mood --------------------------------------------------------------
    const moodNum = clause.match(/\bmood\s*(?:is|was|:|=|at|of)?\s*(\d)(?:\s*\/\s*5)?\b/i);
    if (moodNum) {
      const note = tidy(clause.replace(moodNum[0], '').replace(/^(?:because|since|as|-)\s*/i, ''));
      plan.mood = { score: clamp(parseInt(moodNum[1], 10), 1, 5), note: note || undefined };
      continue;
    }
    const moodWord = clause.match(MOOD_WORD_RE);
    if (moodWord) {
      plan.mood = { score: MOOD_WORDS[moodWord[1].toLowerCase()], note: clause };
      continue;
    }

    // ---- time logs that lead with a number ("90m deep work", "2h coding") ---
    const leadDuration = /^(?:\d|did\b|spent\b|logged\b)/i.test(clause) ? durationMinutes(clause) : null;
    if (leadDuration != null && leadDuration > 0) {
      const hit = CATEGORY_WORDS.find((c) => c.re.test(clause));
      if (hit) {
        plan.timeLogs.push({ category: hit.category, minutes: leadDuration, note: clause });
        continue;
      }
    }

    // ---- completed task ----------------------------------------------------
    const done = clause.match(/^(?:finished|completed|done with|done|shipped|wrapped up|closed|submitted|sent off|sent|delivered|fixed|merged)\s+(.+)$/i)
      || clause.match(/^(.+?)\s+(?:is done|is finished|is complete|done|finished|completed)$/i);
    if (done) {
      const title = tidy(done[1].replace(/\b(today|finally|just)\b/gi, '').replace(/!+/g, ''));
      if (title) {
        plan.completedTasks.push(title);
        continue;
      }
    }

    // ---- hurdle ------------------------------------------------------------
    const hurdle = clause.match(/^(?:stuck on|stuck with|blocked on|blocked by|struggling with|hurdle:?|can't (?:finish|do|start|figure out)|cannot (?:finish|start)|blocked:?)\s+(.+)$/i);
    if (hurdle) {
      const subject = tidy(hurdle[1]);
      plan.hurdles.push({ subject, description: clause });
      continue;
    }

    // ---- new task ----------------------------------------------------------
    const todo = clause.match(/^(?:todo|to-do|to do|task|tasks?:|need to|needs to|have to|must|remind me to|add task|add|plan to|should|gotta|got to)\s*:?\s*(.+)$/i);
    if (todo) {
      const { priority, cleaned } = priorityFrom(todo[1]);
      if (cleaned) {
        plan.newTasks.push({ title: tidy(cleaned), priority });
        continue;
      }
    }

    // ---- time logs ---------------------------------------------------------
    const minutes = durationMinutes(clause);
    if (minutes != null && minutes > 0) {
      const hit = CATEGORY_WORDS.find((c) => c.re.test(clause));
      if (hit) {
        plan.timeLogs.push({ category: hit.category, minutes, note: clause });
        continue;
      }
    }

    // ---- fuel (food / caffeine) --------------------------------------------
    const tags = fuelTags(clause);
    if (FUEL_START_RE.test(clause) || (tags.length > 0 && clause.split(/\s+/).length <= 8)) {
      plan.fuel.notes.push(clause);
      for (const t of tags) if (!plan.fuel.tags.includes(t)) plan.fuel.tags.push(t);
      continue;
    }

    // ---- journal -----------------------------------------------------------
    const journal = clause.match(/^(?:note|journal|thought|reflection|j|dear diary)\s*:\s*(.+)$/i)
      || clause.match(/^((?:grateful|proud|thankful|worried|excited|realized|realised|learned that|noticed)\b.+)$/i);
    if (journal) {
      plan.journal.push(tidy(journal[1]));
      continue;
    }

    plan.unparsed.push(clause);
  }

  return plan;
}

export const OMNI_CATEGORIES = TIME_CATEGORIES;
