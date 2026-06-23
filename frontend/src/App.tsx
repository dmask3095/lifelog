import { useState } from 'react';
import AgendaView from './components/AgendaView';
import HealthPanel from './components/HealthPanel';
import TimePanel from './components/TimePanel';
import BodyPanel from './components/BodyPanel';
import Dashboard from './components/Dashboard';
import HabitPanel from './components/HabitPanel';
import MoodPanel from './components/MoodPanel';
import JournalPanel from './components/JournalPanel';
import GroceriesPanel from './components/GroceriesPanel';
import AuthScreen from './components/AuthScreen';
import AccountPanel from './components/AccountPanel';
import { useAuth } from './context/AuthContext';
import './App.css';

type Tab = 'dashboard' | 'agenda' | 'habits' | 'health' | 'groceries' | 'journal' | 'account';

const TAB_META: Record<Tab, { icon: string; label: string; eyebrow: string; description: string; tooltip: string }> = {
  dashboard: {
    icon: '📊',
    label: 'Day',
    eyebrow: 'Daily Pulse',
    description: 'See your energy, momentum, and signals in one vivid snapshot.',
    tooltip: 'Mission control for your day. Tiny charts, big main-character energy.',
  },
  agenda: {
    icon: '✅',
    label: 'Tasks',
    eyebrow: 'Focus Queue',
    description: 'Sort the day into clear priorities and keep the next move obvious.',
    tooltip: 'Open the battle plan. Priorities first, chaos second.',
  },
  habits: {
    icon: '🔥',
    label: 'Habits',
    eyebrow: 'Streak Studio',
    description: 'Turn repeated wins into visible streaks that feel satisfying to maintain.',
    tooltip: 'Visit the streak forge. Repeated tiny wins become legendary.',
  },
  health: {
    icon: '💚',
    label: 'Health',
    eyebrow: 'Body Signals',
    description: 'Track hydration, time, recovery, and mood in one calming control room.',
    tooltip: 'Check the human maintenance panel. Hydrate the creature.',
  },
  groceries: {
    icon: '🛒',
    label: 'Groceries',
    eyebrow: 'Kitchen Radar',
    description: 'See what is stocked, what needs eating, and what dinner is trying to become.',
    tooltip: 'Open the kitchen radar. Fridge diplomacy happens here.',
  },
  journal: {
    icon: '📓',
    label: 'Journal',
    eyebrow: 'Reflection Space',
    description: 'Capture the story behind the data while it is still fresh and honest.',
    tooltip: 'Open the thought vault. Feelings and plot twists live here.',
  },
  account: {
    icon: '⚙️',
    label: 'Account',
    eyebrow: 'Your Space',
    description: 'Manage your profile, password, and account.',
    tooltip: 'Manage your profile, password, and account.',
  },
};

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'dashboard', icon: '📊', label: 'Day' },
  { id: 'agenda', icon: '✅', label: 'Tasks' },
  { id: 'habits', icon: '🔥', label: 'Habits' },
  { id: 'health', icon: '💚', label: 'Health' },
  { id: 'groceries', icon: '🛒', label: 'Groceries' },
  { id: 'journal', icon: '📓', label: 'Journal' },
  { id: 'account', icon: '⚙️', label: 'Account' },
];

export default function App() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const today = new Date().toISOString().split('T')[0];
  const activeMeta = TAB_META[activeTab];

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
              <span className="hero-badge">LifeLog</span>
            </div>
            <h1>Sign in</h1>
            <p className="hero-description">Your own private space for tasks, habits, and reflections.</p>
          </div>
        </header>
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-orb app-orb-one" />
      <div className="app-orb app-orb-two" />
      <div className="app-grid" />

      <header className="app-header">
        <div className="hero-copy">
          <div className="hero-badges">
            <span className="hero-badge">LifeLog</span>
            <span className="hero-badge subtle">{new Date().toDateString()}</span>
            <span className="hero-badge subtle">
              {user.displayName || user.email}
              <button type="button" className="hero-logout" onClick={() => logout()} aria-label="Log out">⎋</button>
            </span>
          </div>
          <p className="hero-eyebrow">{activeMeta.eyebrow}</p>
          <h1>{activeMeta.label}</h1>
          <p className="hero-description">{activeMeta.description}</p>
        </div>

        <div className="hero-graphic" aria-hidden="true">
          <div className="hero-graphic-panel top">
            <span className="spark" />
            <span className="spark" />
            <span className="spark wide" />
          </div>
          <div className="hero-graphic-panel middle">
            <span className="pulse-ring" />
            <span className="pulse-ring small" />
          </div>
          <div className="hero-graphic-panel bottom">
            <span className="mini-dot warm" />
            <span className="mini-dot cool" />
            <span className="mini-line" />
          </div>
        </div>
      </header>

      <div className="tab-strip">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-chip tooltip-trigger ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            data-tooltip={TAB_META[tab.id].tooltip}
            aria-label={`${tab.label}. ${TAB_META[tab.id].tooltip}`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <main className="content">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'agenda' && <AgendaView date={today} />}
        {activeTab === 'habits' && <HabitPanel date={today} />}
        {activeTab === 'health' && (
          <div className="panel">
            <HealthPanel date={today} />
            <TimePanel date={today} />
            <BodyPanel date={today} />
            <MoodPanel date={today} />
          </div>
        )}
        {activeTab === 'groceries' && <GroceriesPanel />}
        {activeTab === 'journal' && <JournalPanel date={today} />}
        {activeTab === 'account' && <AccountPanel />}
      </main>

      <nav className="bottom-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`nav-btn tooltip-trigger ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            data-tooltip={TAB_META[tab.id].tooltip}
            aria-label={`${tab.label}. ${TAB_META[tab.id].tooltip}`}
          >
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
