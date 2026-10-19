import { useRef, useState, type FormEvent } from 'react';
import { BedDouble, Check, ListChecks, Loader2, Plus, Repeat2, Sparkles } from 'lucide-react';
import { api, createHabit, createTask } from '../../api';
import { useRefresh } from '../../context/RefreshContext';
import type { EnergyTag, SummaryData } from '../../types';
import { errorText, formatSleep, onboardingProgress, sleepMinutesBetween } from './dayPlan';

// Three real steps for a brand-new account. Every step writes through the normal API,
// so the plan it ends on is built from data the person actually entered.
const HABITS: Array<{ name: string; icon: string; floor: string; target: string; stretch: string }> = [
  { name: 'Morning walk', icon: '🚶', floor: '5 min outside', target: '20 min walk', stretch: '45 min + sun' },
  { name: 'Reading', icon: '📖', floor: '2 pages', target: '20 min', stretch: '1 chapter' },
  { name: 'Meditation', icon: '🧘', floor: '3 breaths', target: '10 min sit', stretch: '20 min' },
  { name: 'Exercise', icon: '💪', floor: '10 squats', target: '30 min session', stretch: '60 min' },
  { name: 'Water 2L', icon: '💧', floor: '1 glass on waking', target: '2L', stretch: '3L' },
  { name: 'No phone before 10am', icon: '📵', floor: 'Not in bed', target: 'Until 10am', stretch: 'Until noon' },
];

const ENERGIES: Array<{ id: EnergyTag; label: string }> = [
  { id: 'deep', label: 'Deep' },
  { id: 'admin', label: 'Admin' },
  { id: 'quick', label: 'Quick' },
];

interface Props {
  date: string;
  data: SummaryData | null;
  building: boolean;
  buildError: string | null;
  onBuild: () => void;
  onSkip: () => void;
}

export default function FirstRun({ date, data, building, buildError, onBuild, onSkip }: Props) {
  const { bump } = useRefresh();
  const [bed, setBed] = useState('23:00');
  const [wake, setWake] = useState('07:00');
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepError, setSleepError] = useState<string | null>(null);
  const [loggedSleep, setLoggedSleep] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [energy, setEnergy] = useState<EnergyTag>('deep');
  const [added, setAdded] = useState<string[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskHint, setTaskHint] = useState<string | null>(null);
  const taskInput = useRef<HTMLInputElement>(null);
  const taskBusy = useRef(false);

  const [habitBusy, setHabitBusy] = useState<string | null>(null);
  const [habitError, setHabitError] = useState<string | null>(null);
  const [pickedHabits, setPickedHabits] = useState<string[]>([]);
  const [nudge, setNudge] = useState<string | null>(null);

  const serverTitles = (data?.tasks.items ?? []).map((t) => t.title);
  const taskTitles = [...added.filter((t) => !serverTitles.includes(t)), ...serverTitles];
  const progress = onboardingProgress(data, taskTitles.length);
  const sleepDone = progress.sleep || loggedSleep != null;
  const habitNames = new Set([...(data?.habits.items ?? []).map((h) => h.name), ...pickedHabits]);
  const habitCount = Math.max(progress.habits, habitNames.size);
  const tasksDone = taskTitles.length >= 3;
  const habitsDone = habitCount >= 2;
  const allDone = sleepDone && tasksDone && habitsDone;
  const step = !sleepDone ? 0 : !tasksDone ? 1 : !habitsDone ? 2 : 3;
  const sleepMinutes = data && data.body.totalSleepMinutes > 0 ? data.body.totalSleepMinutes : loggedSleep;

  const logSleep = async (e: FormEvent) => {
    e.preventDefault();
    if (sleepBusy) return;
    setSleepBusy(true);
    setSleepError(null);
    const minutes = sleepMinutesBetween(bed, wake);
    try {
      await api.post('/body-logs', { date, type: 'sleep', time: bed, duration_minutes: minutes });
      setLoggedSleep(minutes);
      bump();
    } catch (err) {
      setSleepError(errorText(err, 'Couldn’t save your sleep'));
    } finally {
      setSleepBusy(false);
    }
  };

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) {
      setTaskHint('Type a task first, then press Enter.');
      taskInput.current?.focus();
      return;
    }
    if (taskBusy.current) return;
    taskBusy.current = true;
    setTaskError(null);
    setTaskHint(null);
    setAdded((a) => [clean, ...a]);
    setTitle('');
    taskInput.current?.focus();
    try {
      await createTask({ title: clean, date, energy_tag: energy, priority: energy === 'deep' ? 'high' : 'medium' });
      bump();
    } catch (err) {
      setAdded((a) => { const i = a.indexOf(clean); return i < 0 ? a : [...a.slice(0, i), ...a.slice(i + 1)]; });
      setTitle(clean);
      setTaskError(errorText(err, 'Couldn’t add that task'));
    } finally {
      taskBusy.current = false;
    }
  };

  const pickHabit = async (h: (typeof HABITS)[number]) => {
    if (habitBusy || habitNames.has(h.name)) return;
    setHabitBusy(h.name);
    setHabitError(null);
    try {
      await createHabit({ name: h.name, icon: h.icon, floor_label: h.floor, target_label: h.target, stretch_label: h.stretch });
      setPickedHabits((p) => [...p, h.name]);
      bump();
    } catch (err) {
      setHabitError(errorText(err, `Couldn’t add ${h.name}`));
    } finally {
      setHabitBusy(null);
    }
  };

  const stepClass = (i: number, done: boolean) => `tv-step ${done ? 'is-done' : ''} ${step === i ? 'is-current' : ''}`;

  return (
    <section className="tv-firstrun" aria-labelledby="tv-firstrun-title">
      <header className="tv-firstrun-head">
        <div>
          <p className="tv-eyebrow">Three steps · about a minute</p>
          <h2 id="tv-firstrun-title" className="tv-firstrun-title">Let LifeLog plan your first day</h2>
          <p className="tv-muted">Your sleep sets today’s capacity; your tasks and habits fill the plan around it.</p>
        </div>
        <button type="button" className="tv-link" onClick={onSkip}>Skip setup</button>
      </header>

      <ol className="tv-steps">
        <li className={stepClass(0, sleepDone)}>
          <div className="tv-step-head">
            <span className="tv-step-num">{sleepDone ? <Check size={14} strokeWidth={2.6} /> : <BedDouble size={14} />}</span>
            <span className="tv-step-title">Log last night’s sleep</span>
          </div>
          {sleepDone ? (
            <p className="tv-step-done">{sleepMinutes ? `${formatSleep(sleepMinutes)} logged` : 'Sleep logged'}</p>
          ) : (
            <form className="tv-step-body" onSubmit={logSleep}>
              <div className="tv-field-row">
                <label className="tv-field"><span>Went to bed</span><input type="time" className="tv-input" value={bed} onChange={(e) => setBed(e.target.value)} /></label>
                <label className="tv-field"><span>Woke up</span><input type="time" className="tv-input" value={wake} onChange={(e) => setWake(e.target.value)} /></label>
              </div>
              <button type="submit" className="tv-btn tv-btn-primary tv-btn-block">
                {sleepBusy ? <Loader2 className="tv-spin" size={16} /> : <Check size={16} />}
                <span>Log {formatSleep(sleepMinutesBetween(bed, wake))}</span>
              </button>
              {sleepError && <p className="tv-inline-error" role="alert">{sleepError}</p>}
            </form>
          )}
        </li>

        <li className={stepClass(1, tasksDone)}>
          <div className="tv-step-head">
            <span className="tv-step-num">{tasksDone ? <Check size={14} strokeWidth={2.6} /> : <ListChecks size={14} />}</span>
            <span className="tv-step-title">Add 3 tasks</span>
            <span className="tv-step-count">{Math.min(3, taskTitles.length)}/3</span>
          </div>
          <form className="tv-step-body" onSubmit={addTask}>
            <div className="tv-seg" role="radiogroup" aria-label="Energy needed">
              {ENERGIES.map((en) => (
                <button key={en.id} type="button" role="radio" aria-checked={energy === en.id} className={`tv-seg-btn ${energy === en.id ? 'is-on' : ''}`} onClick={() => setEnergy(en.id)}>{en.label}</button>
              ))}
            </div>
            <div className="tv-input-row">
              <input ref={taskInput} className="tv-input" value={title} onChange={(e) => { setTitle(e.target.value); setTaskHint(null); }} placeholder={energy === 'deep' ? 'e.g. Write the launch post' : energy === 'admin' ? 'e.g. Reply to Sam' : 'e.g. Book dentist'} aria-label="Task title" />
              <button type="submit" className="tv-btn tv-btn-primary"><Plus size={16} /><span>Add</span></button>
            </div>
            {taskHint && <p className="tv-hint">{taskHint}</p>}
            {taskError && <p className="tv-inline-error" role="alert">{taskError}</p>}
            {taskTitles.length > 0 && (
              <ul className="tv-mini-list">{taskTitles.slice(0, 5).map((t, i) => <li key={`${t}-${i}`}><Check size={13} /> {t}</li>)}</ul>
            )}
          </form>
        </li>

        <li className={stepClass(2, habitsDone)}>
          <div className="tv-step-head">
            <span className="tv-step-num">{habitsDone ? <Check size={14} strokeWidth={2.6} /> : <Repeat2 size={14} />}</span>
            <span className="tv-step-title">Pick 2 habits</span>
            <span className="tv-step-count">{Math.min(2, habitCount)}/2</span>
          </div>
          <div className="tv-step-body">
            <div className="tv-habit-picks">
              {HABITS.map((h) => {
                const on = habitNames.has(h.name);
                return (
                  <button key={h.name} type="button" className={`tv-pick ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => pickHabit(h)}>
                    <span className="tv-pick-name">{habitBusy === h.name ? <Loader2 className="tv-spin" size={14} /> : on ? <Check size={14} /> : null}{h.name}</span>
                    <span className="tv-pick-sub">floor: {h.floor}</span>
                  </button>
                );
              })}
            </div>
            {habitError && <p className="tv-inline-error" role="alert">{habitError}</p>}
          </div>
        </li>
      </ol>

      <footer className="tv-firstrun-foot">
        <button type="button" className={`tv-btn tv-btn-primary tv-btn-lg ${allDone ? '' : 'is-soft'}`} onClick={() => (allDone ? onBuild() : setNudge(`Finish step ${step + 1} first: ${['log your sleep', 'add 3 tasks', 'pick 2 habits'][step] ?? ''}.`))} aria-describedby="tv-firstrun-status">
          {building ? <Loader2 className="tv-spin" size={18} /> : <Sparkles size={18} />}
          <span>Build my plan</span>
        </button>
        <span id="tv-firstrun-status" className="tv-muted">
          {!allDone && nudge ? nudge : allDone ? 'Ready: your plan will be built from what you just entered.' : `${[sleepDone, tasksDone, habitsDone].filter(Boolean).length}/3 steps done`}
        </span>
        {buildError && <p className="tv-inline-error" role="alert">{buildError}</p>}
      </footer>
    </section>
  );
}
