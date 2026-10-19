import { useCallback, useEffect, useState } from 'react';
import AgendaView from './components/AgendaView';
import HealthHub from './components/HealthHub';
import Dashboard from './components/Dashboard';
import HabitPanel from './components/HabitPanel';
import JournalPanel from './components/JournalPanel';
import AuthScreen from './components/AuthScreen';
import AccountPanel from './components/AccountPanel';
import OmniBar from './components/OmniBar';
import DateStrip from './components/DateStrip';
import ScoreRing from './components/ScoreRing';
import { useAuth } from './context/AuthContext';
import { RefreshProvider, useRefresh } from './context/RefreshContext';
import { getSummary } from './api';
import { shiftDate, todayLocal } from './lib/dates';
import type { SummaryData } from './types';
import './App.css';
import './v2.css';

export type Tab = 'dashboard' | 'agenda' | 'habits' | 'health' | 'journal' | 'account';

const TAB_META: Record<Tab, { icon: string; label: string; eyebrow: string; description: string }> = {
  dashboard: { icon: '📊', label: 'Day', eyebrow: 'Daily pulse', description: 'Capacity, scores and the one pattern that matters today.' },
  agenda: { icon: '✅', label: 'Tasks', eyebrow: 'Focus queue', description: 'Priorities first. Stuck? Flag the hurdle and split it.' },
  habits: { icon: '🔥', label: 'Habits', eyebrow: 'Elastic streaks', description: 'Bronze on hard days still counts. Shields cover the rest.' },
  health: { icon: '💚', label: 'Health', eyebrow: 'Body signals', description: 'Fuel, time, sleep and mood feed your capacity score.' },
  journal: { icon: '📓', label: 'Journal', eyebrow: 'Reflection', description: 'Prompts grounded in what actually happened today.' },
  account: { icon: '⚙️', label: 'Account', eyebrow: 'Your space', description: 'Profile, password, export and account.' },
};

const TABS: Tab[] = ['dashboard', 'agenda', 'habits', 'health', 'journal', 'account'];

function Shell() {
  const { user, loading, logout } = useAuth();
  const { tick } = useRefresh();
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const activeMeta = TAB_META[activeTab];

  const reloadSummary = useCallback(() => {
    if (!user) return;
    setSummaryLoading(true);
    getSummary(date)
      .then((res) => setSummary(res.data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [user, date]);

  useEffect(() => { reloadSummary(); }, [reloadSummary, tick, activeTab]);

  // [ and ] move through days; keeps hands on the keyboard on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === '[') setDate((d) => shiftDate(d, -1));
      if (e.key === ']') setDate((d) => shiftDate(d, 1));
      if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) setDate(today);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today]);

  if (loading) {
    return <div className="app-loading">Loading LifeLog…</div>;
  }

  if (!user) {
    return (
      <div className="app">
        <div className="app-orb app-orb-one" />
        <div className="app-orb app-orb-two" />
        <div className="app-grid" />
        <header className="app-header auth-header">
          <div className="hero-copy">
            <div className="hero-badges">
              <span className="hero-badge">LifeLog 2.0</span>
            </div>
            <h1>Sign in</h1>
            <p className="hero-description">Plan by your real energy. Log your day in one line. See what actually drives your best days.</p>
          </div>
        </header>
        <AuthScreen />
      </div>
    );
  }

  const capacity = summary?.capacity;
  const capScore = capacity?.score ?? null;
  const capColor = capacity?.level === 'recovery' ? '#ff9b6b' : capacity?.level === 'peak' ? '#7ce2b6' : '#59c3ff';

  return (
    <div className="app">
      <div className="app-orb app-orb-one" />
      <div className="app-orb app-orb-two" />
      <div className="app-grid" />

      <header className="app-header">
        <div className="hero-copy">
          <div className="hero-badges">
            <span className="hero-badge">LifeLog 2.0</span>
            <span className="hero-badge subtle">
              {user.displayName || user.email}
              <button type="button" className="hero-logout" onClick={() => logout()} aria-label="Log out">⎋</button>
            </span>
          </div>
          <p className="hero-eyebrow">{activeMeta.eyebrow}</p>
          <h1>{activeMeta.label}</h1>
          <p className="hero-description">{activeMeta.description}</p>
        </div>

        <button type="button" className="hero-stat hero-stat-btn" title="Today's capacity" onClick={() => setActiveTab('dashboard')}>
          {summaryLoading && !summary ? (
            <span className="hero-stat-loading">…</span>
          ) : capScore == null ? (
            <>
              <ScoreRing score={0} color="#3a4a60" size={70} />
              <span className="hero-stat-caption">Log sleep or mood</span>
            </>
          ) : (
            <>
              <ScoreRing score={capScore} color={capColor} size={70} />
              <span className="hero-stat-caption">Capacity · {capacity?.level}</span>
            </>
          )}
        </button>
      </header>

      <div className="content omni-wrap">
        <OmniBar date={date} />
        <DateStrip date={date} today={today} onChange={setDate} />
      </div>

      <div className="tab-strip">
        {TABS.map((tab) => (
          <button key={tab} className={`tab-chip ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span>{TAB_META[tab].icon}</span>
            <span>{TAB_META[tab].label}</span>
          </button>
        ))}
      </div>

      <main className="content main-content">
        {activeTab === 'dashboard' && <Dashboard date={date} today={today} data={summary} loading={summaryLoading} onNavigate={setActiveTab} />}
        {activeTab === 'agenda' && <AgendaView date={date} today={today} summary={summary} onChanged={reloadSummary} />}
        {activeTab === 'habits' && <HabitPanel date={date} onChanged={reloadSummary} />}
        {activeTab === 'health' && <HealthHub date={date} onChanged={reloadSummary} />}
        {activeTab === 'journal' && <JournalPanel date={date} summary={summary} />}
        {activeTab === 'account' && <AccountPanel />}
      </main>

      <nav className="bottom-nav">
        {TABS.map((tab) => (
          <button key={tab} className={`nav-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)} aria-label={TAB_META[tab].label}>
            <span className="nav-icon">{TAB_META[tab].icon}</span>
            <span className="nav-label">{TAB_META[tab].label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <RefreshProvider>
      <Shell />
    </RefreshProvider>
  );
}
