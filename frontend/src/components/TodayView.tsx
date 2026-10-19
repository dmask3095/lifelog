import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Droplet, Loader2, Moon, RefreshCw, Smile, Sparkles, Sunrise, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useRefresh } from '../context/RefreshContext';
import { shiftDate } from '../lib/dates';
import type { SummaryData } from '../types';
import type { Tab } from '../App';
import QuickAddTask from './QuickAddTask';
import CapacityDial from './today/CapacityDial';
import PlanBlockRow from './today/PlanBlockRow';
import FirstRun from './today/FirstRun';
import EveningWrap from './today/EveningWrap';
import {
  dayScore, deferredCount, errorText, formatSleep, isFreshAccount, lastNightText, pickPlan, planApi, planStats,
  type BlockAction, type DayPlan, type PlanBlock,
} from './today/dayPlan';

export interface TodayViewProps {
  date: string;
  today: string;
  data: SummaryData | null;
  loading: boolean;
  onNavigate: (tab: Tab) => void;
}

const EVENING_HOUR = 18;
const LEVEL_LABEL: Record<string, string> = { recovery: 'Recovery day', steady: 'Steady day', peak: 'Peak day' };
const nowHourOf = (t: number) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };

function readStore(key: string | null, session = false): string | null {
  if (!key) return null;
  try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; }
}
function writeStore(key: string | null, value: string, session = false) {
  if (!key) return;
  try { (session ? sessionStorage : localStorage).setItem(key, value); } catch { /* storage unavailable */ }
}

function applyOptimistic(plan: DayPlan, id: string, action: BlockAction, startHour?: number): DayPlan {
  return {
    ...plan,
    blocks: plan.blocks.map((b): PlanBlock => {
      if (b.id !== id) return b;
      if (action === 'start') return { ...b, status: 'active', startedAt: b.startedAt ?? Date.now() };
      if (action === 'done') return { ...b, status: 'done', completedAt: Date.now() };
      if (action === 'skip') return { ...b, status: 'skipped', startedAt: null };
      return { ...b, start: startHour ?? b.start, status: b.status === 'skipped' ? 'planned' : b.status };
    }).sort((a, b) => a.start - b.start),
  };
}

export default function TodayView({ date, today, data, loading, onNavigate }: TodayViewProps) {
  const { user } = useAuth();
  const { tick, bump } = useRefresh();
  const dayApi = useMemo(() => planApi(api), []);
  const isToday = date === today;

  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, BlockAction>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef<Set<string>>(new Set());
  const loadSeq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (wrapOpen) wrapRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [wrapOpen]);
  const closeWrap = () => { setWrapOpen(false); heroRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); };

  // ---- onboarding / ritual memory ------------------------------------------
  const obKey = user ? `lifelog.onboarding.${user.id}` : null;
  const [obState, setObState] = useState<string | null>(() => readStore(obKey));
  useEffect(() => { setObState(readStore(obKey)); }, [obKey]);
  useEffect(() => {
    if (!obState && isToday && isFreshAccount(data)) { writeStore(obKey, 'active'); setObState('active'); }
  }, [obState, isToday, data, obKey]);
  const showFirstRun = obState === 'active' && isToday;

  const morningKey = user ? `lifelog.morning.${user.id}.${date}` : null;
  const [morningHidden, setMorningHidden] = useState(() => readStore(morningKey, true) === 'hidden');
  useEffect(() => { setMorningHidden(readStore(morningKey, true) === 'hidden'); }, [morningKey]);

  // ---- plan loading ---------------------------------------------------------
  const loadPlan = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await dayApi.get(date, isToday);
      if (seq !== loadSeq.current) return;
      setPlan(pickPlan(res.data));
      setPlanError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setPlanError(errorText(err, 'Couldn’t load today’s plan'));
    } finally {
      if (seq === loadSeq.current) setPlanLoading(false);
    }
  }, [dayApi, date, isToday]);

  useEffect(() => { setPlan(null); setPlanLoading(true); setWrapOpen(false); setMoveOpen(null); setRowErrors({}); }, [date]);
  useEffect(() => { if (!showFirstRun) void loadPlan(); }, [loadPlan, tick, showFirstRun]);

  // A ticking clock only while a block runs; elapsed time is always derived from the
  // server's startedAt, so navigation or a reload never loses the timer.
  const hasActive = !!plan?.blocks.some((b) => b.status === 'active');
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), hasActive ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [hasActive]);

  // ---- actions ---------------------------------------------------------------
  const runAction = useCallback(async (block: PlanBlock, action: BlockAction, startHour?: number) => {
    const key = block.id;
    if (inflight.current.has(key)) return; // late double clicks from a laggy mirror are ignored, not errors
    inflight.current.add(key);
    setPending((p) => ({ ...p, [key]: action }));
    setRowErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    if (action === 'move') setMoveOpen(null);
    const before = plan;
    if (before) setPlan(applyOptimistic(before, key, action, startHour));
    try {
      const res = await dayApi.action(date, key, action, startHour);
      loadSeq.current++; // supersede any GET that started before this write
      const next = pickPlan(res.data);
      if (next) setPlan(next); else await loadPlan();
      if (action === 'start' && next && !next.accepted && isToday) {
        dayApi.patch(date, { accepted: true }).then(() => setPlan((p) => p ? { ...p, accepted: true } : p)).catch(() => {});
      }
      if (action === 'done') bump(); // tasks, habits and time logs changed server-side
    } catch (err) {
      if (before) setPlan(before);
      setRowErrors((e) => ({ ...e, [key]: errorText(err, action === 'done' ? 'Couldn’t mark it done' : action === 'start' ? 'Couldn’t start the timer' : action === 'skip' ? 'Couldn’t skip it' : 'Couldn’t move it') }));
    } finally {
      inflight.current.delete(key);
      setPending((p) => { const n = { ...p }; delete n[key]; return n; });
    }
  }, [plan, dayApi, date, isToday, loadPlan, bump]);

  const replan = useCallback(async () => {
    if (inflight.current.has('__replan')) return;
    inflight.current.add('__replan');
    setReplanning(true);
    setPlanError(null);
    try {
      const res = await dayApi.replan(date, isToday);
      loadSeq.current++;
      const next = pickPlan(res.data);
      if (next) setPlan(next); else await loadPlan();
      setJustAdded(false);
      return true;
    } catch (err) {
      setPlanError(errorText(err, 'Couldn’t replan'));
      return false;
    } finally {
      inflight.current.delete('__replan');
      setReplanning(false);
    }
  }, [dayApi, date, isToday, loadPlan]);

  const accept = useCallback(async () => {
    if (inflight.current.has('__accept') || !plan) return;
    inflight.current.add('__accept');
    setAccepting(true);
    const before = plan;
    setPlan({ ...plan, accepted: true });
    try {
      const res = await dayApi.patch(date, { accepted: true });
      const next = pickPlan(res.data);
      if (next) setPlan(next);
    } catch (err) {
      setPlan(before);
      setPlanError(errorText(err, 'Couldn’t save that you accepted the plan'));
    } finally {
      inflight.current.delete('__accept');
      setAccepting(false);
    }
  }, [plan, dayApi, date]);

  const [buildError, setBuildError] = useState<string | null>(null);
  const finishOnboarding = async () => {
    setBuildError(null);
    const ok = await replan();
    if (ok) { writeStore(obKey, 'done'); setObState('done'); bump(); }
    else setBuildError('Couldn’t build the plan yet. Your entries are saved; try again.');
  };
  const skipOnboarding = () => { writeStore(obKey, 'dismissed'); setObState('dismissed'); };

  // ---- derived -----------------------------------------------------------------
  const hourNow = nowHourOf(now);
  const isEvening = isToday && hourNow >= EVENING_HOUR;
  const morning = isToday && !!plan && !plan.accepted && !isEvening && !morningHidden;
  const wrapped = !!plan?.wrap?.savedAt;
  const stats = planStats(plan);
  const capacityKnown = data ? data.capacity.score != null : !!plan?.capacityKnown;
  const capacityValue = data?.capacity.score ?? plan?.capacity ?? null;
  const level = (data?.capacity.level !== 'unknown' ? data?.capacity.level : undefined) ?? plan?.level;
  const dialLabel = capacityKnown && level ? LEVEL_LABEL[level] ?? level : 'Assumed · log sleep';
  const nextId = plan?.blocks.find((b) => b.status === 'planned' || b.status === 'active')?.id ?? null;
  const deferred = deferredCount(plan);
  const insight = data?.insight ?? null;
  const lastNight = lastNightText(data);
  const score = dayScore(plan, data);

  if (showFirstRun) {
    return (
      <div className="tv">
        <FirstRun date={date} data={data} building={replanning} buildError={buildError} onBuild={() => void finishOnboarding()} onSkip={skipOnboarding} />
      </div>
    );
  }

  const patternLine = insight
    ? <>{insight.detail} {lastNight && <strong>{lastNight}</strong>}</>
    : <>{(data?.loggedDays30 ?? 0) < 7
        ? `Patterns unlock after 7 logged days (${data?.loggedDays30 ?? 0}/7 so far).`
        : 'No reliable pattern in your last 30 days yet.'} {lastNight && <strong>{lastNight}</strong>}</>;
  const patternMeta = insight ? `${insight.confidence === 'solid' ? 'Solid' : 'Early'} signal · n=${insight.n} days` : 'Honest: not enough data';

  return (
    <div className="tv">
      <section className="tv-capture" aria-label="Quick add">
        <QuickAddTask date={date} onAdded={() => setJustAdded(true)} />
      </section>
      <section ref={heroRef} className={`tv-hero ${morning ? 'is-morning' : ''}`} aria-label="Today’s capacity and plan">
        <div className="tv-hero-dial">
          <CapacityDial capacity={capacityValue} known={capacityKnown} label={dialLabel} blocks={plan?.blocks ?? []}
            window={plan?.window ?? null} nowHour={isToday ? hourNow : null} />
          <div className="tv-signals">
            <button type="button" className={`tv-signal ${data?.capacity.signals.sleep ? 'is-on' : ''}`} onClick={() => onNavigate('health')}>
              <Moon size={14} /><span>{data?.capacity.signals.sleep ? formatSleep(data.body.totalSleepMinutes) : 'Log sleep'}</span>
            </button>
            <button type="button" className={`tv-signal ${data?.capacity.signals.mood ? 'is-on' : ''}`} onClick={() => onNavigate('health')}>
              <Smile size={14} /><span>{data?.mood ? `${data.mood.score}/5` : 'Mood'}</span>
            </button>
            <button type="button" className={`tv-signal ${data?.capacity.signals.water ? 'is-on' : ''}`} onClick={() => onNavigate('health')}>
              <Droplet size={14} /><span>{data && data.health.totalWater > 0 ? `${(data.health.totalWater / 1000).toFixed(1)}L` : 'Water'}</span>
            </button>
          </div>
        </div>

        <div className="tv-hero-plan">
          <header className="tv-plan-head">
            <div className="tv-plan-headline">
              <p className="tv-eyebrow">{morning ? <><Sunrise size={13} /> Your daily brief · your plan</> : isToday ? 'Your plan' : `Plan · ${date}`}
                {plan && stats.total > 0 && <span className="tv-eyebrow-count">{stats.done}/{stats.total} done</span>}</p>
              <p className="tv-why">{plan?.why ?? (planLoading ? 'Reading your sleep, tasks and habits…' : '')}</p>
            </div>
            <div className="tv-plan-tools">
              <button type="button" className="tv-btn tv-btn-ghost" onClick={() => void replan()} title="Rebuild the plan from your latest logs">
                {replanning ? <Loader2 className="tv-spin" size={16} /> : <RefreshCw size={16} />}<span>Replan</span>
              </button>
              <button type="button" className={`tv-btn ${isEvening && !wrapped ? 'tv-btn-primary' : 'tv-btn-ghost'}`} onClick={() => setWrapOpen((o) => !o)} aria-expanded={wrapOpen}>
                <Moon size={16} /><span>{wrapped ? 'Wrap' : 'Wrap up'}</span>
              </button>
            </div>
          </header>

          {morning && (
            <div className="tv-morning">
              <div className="tv-morning-pattern">
                <span className="tv-morning-meta"><Sparkles size={13} /> {patternMeta}</span>
                <p>{patternLine}</p>
              </div>
              <div className="tv-morning-actions">
                <button type="button" className="tv-btn tv-btn-primary" onClick={() => void accept()}>
                  {accepting ? <Loader2 className="tv-spin" size={16} /> : <Sparkles size={16} />}<span>Accept plan</span>
                </button>
                <button type="button" className="tv-btn tv-btn-icon" aria-label="Hide the morning brief" title="Not now"
                  onClick={() => { writeStore(morningKey, 'hidden', true); setMorningHidden(true); }}><X size={16} /></button>
              </div>
            </div>
          )}

          {planError && (
            <div className="tv-inline-error tv-plan-error" role="alert">
              <span>{planError}</span>
              <button type="button" className="tv-link" onClick={() => { setPlanError(null); void loadPlan(); }}>Retry</button>
            </div>
          )}

          {planLoading && !plan ? (
            <ol className="tv-blocks is-loading" aria-label="Loading plan">{[0, 1, 2].map((i) => <li key={i} className="tv-block tv-skeleton" />)}</ol>
          ) : plan && plan.blocks.length > 0 ? (
            <ol className="tv-blocks">
              {plan.blocks.map((b) => (
                <PlanBlockRow key={b.id} block={b} now={now} nowHour={isToday ? hourNow : null} pending={pending[b.id] ?? null}
                  error={rowErrors[b.id] ?? null} moveOpen={moveOpen === b.id} isNext={b.id === nextId}
                  onToggleMove={() => setMoveOpen((m) => (m === b.id ? null : b.id))} onAction={runAction} />
              ))}
            </ol>
          ) : plan ? (
            <div className="tv-empty">
              <p>Nothing to plan yet. Add a task below and press Replan; LifeLog places it in your best energy window.</p>
            </div>
          ) : null}

          {plan && (deferred > 0 || justAdded) && (
            <p className="tv-deferred">
              {justAdded ? <>New task added. <button type="button" className="tv-link" onClick={() => void replan()}>Replan to fit it in</button>{deferred > 0 ? ' · ' : ''}</> : null}
              {deferred > 0 && `${deferred} task${deferred === 1 ? ' waits' : 's wait'} for tomorrow, without guilt.`}
            </p>
          )}
        </div>
      </section>

      {isEvening && !wrapped && !wrapOpen && plan && (
        <button type="button" className="tv-evening-prompt" onClick={() => setWrapOpen(true)}>
          <Moon size={16} /><span><b>It’s evening.</b> Wrap the day in three quick steps.</span>
        </button>
      )}

      {wrapOpen && (
        <div ref={wrapRef} className="tv-wrap-anchor"><EveningWrap date={date} tomorrow={shiftDate(date, 1)} plan={plan} data={data}
          onClose={closeWrap} onSaved={(p) => { loadSeq.current++; if (p) setPlan(p); else void loadPlan(); }} /></div>
      )}

      {wrapped && !wrapOpen && plan?.wrap && (
        <button type="button" className="tv-wrapped" onClick={() => setWrapOpen(true)}>
          <span className="tv-wrapped-score">{score.score ?? '–'}</span>
          <span className="tv-wrapped-text">
            <b>Day wrapped</b>
            <span>{plan.wrap.tomorrowTop ? `Tomorrow opens with “${plan.wrap.tomorrowTop}”` : 'No top task set for tomorrow'}</span>
          </span>
        </button>
      )}



      {!morning && (
        <section className="tv-pattern" aria-label="Your pattern">
          <span className="tv-morning-meta"><Sparkles size={13} /> Your pattern · {patternMeta}</span>
          <p>{loading && !data ? 'Loading…' : patternLine}</p>
          {(data?.insightCount ?? 0) > 1 && (
            <button type="button" className="tv-link" onClick={() => onNavigate('insights')}>See all {data?.insightCount} patterns</button>
          )}
        </section>
      )}
    </div>
  );
}
