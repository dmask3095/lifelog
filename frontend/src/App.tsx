import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, BookOpen, CheckSquare, ChevronDown, CircleDot, LogOut, Moon, Settings, Sun, Utensils } from 'lucide-react';
import AgendaView from './components/AgendaView';
import HealthHub from './components/HealthHub';
import Dashboard from './components/Dashboard';
import TodayView from './components/TodayView';
import HabitPanel from './components/HabitPanel';
import JournalPanel from './components/JournalPanel';
import AuthScreen from './components/AuthScreen';
import AccountPanel from './components/AccountPanel';
import OmniBar from './components/OmniBar';
import DateStrip from './components/DateStrip';
import { useAuth } from './context/AuthContext';
import { RefreshProvider, useRefresh } from './context/RefreshContext';
import { getSummary } from './api';
import { shiftDate, todayLocal } from './lib/dates';
import type { SummaryData } from './types';
import './App.css';
import './v2.css';
import './v2.1.css';

export type Tab = 'dashboard' | 'agenda' | 'habits' | 'insights' | 'health' | 'journal' | 'account';
const NAV = [
  { id: 'dashboard', label: 'Today', icon: CircleDot },
  { id: 'agenda', label: 'Tasks', icon: CheckSquare },
  { id: 'habits', label: 'Habits', icon: Activity },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'journal', label: 'Journal', icon: BookOpen },
] as const;
const TITLES: Record<Tab, [string,string]> = {
 dashboard: ['A day that works with you.', 'A real plan. Built around your energy, not an endless list.'],
 agenda: ['Make room for what matters.', 'Capture it. Pick a next step. Let the rest wait.'],
 habits: ['Small is still something.', 'Keep your rhythm with a floor, a target and a stretch.'],
 insights: ['Find your own rhythm.', 'Your patterns, with the numbers behind them. Association, not causation.'],
 journal: ['Leave a little room to think.', 'Your day, in your own words.'],
 health: ['Listen to your signals.', 'Sleep, mood, fuel and focused time.'],
 account: ['Your space.', 'Profile, export and account settings.'],
};
function readTab(): Tab {
 const v = new URLSearchParams(location.search).get('view');
 return v && v in TITLES ? v as Tab : 'dashboard';
}
function Shell() {
 const { user, loading, logout } = useAuth();
 const { tick } = useRefresh();
 const today = todayLocal();
 const [date, setDate] = useState(() => new URLSearchParams(location.search).get('day')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? today);
 const [activeTab, setActiveTab] = useState<Tab>(readTab);
 const [summary, setSummary] = useState<SummaryData|null>(null);
 const [summaryLoading, setSummaryLoading] = useState(true);
 const [theme,setTheme] = useState(() => localStorage.getItem('lifelog-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
 const [more,setMore] = useState(false);
 const request = useRef(0);
 useEffect(() => { document.documentElement.dataset.theme=theme; localStorage.setItem('lifelog-theme',theme); },[theme]);
 const navigate = (tab:Tab) => { const u=new URL(location.href); u.searchParams.set('view',tab); u.searchParams.set('day',date); history.pushState({},'',u); setActiveTab(tab); setMore(false); };
 const changeDate = (d:string) => { const u=new URL(location.href);u.searchParams.set('day',d);history.pushState({},'',u);setDate(d); };
 useEffect(() => {const sync=()=>{setActiveTab(readTab());setDate(new URLSearchParams(location.search).get('day') ?? today);};window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[today]);
 const reloadSummary = useCallback(() => {
  if (!user) return;
  const n=++request.current;setSummaryLoading(true);
  getSummary(date).then(r=>{if(n===request.current)setSummary(r.data);}).catch(()=>{if(n===request.current)setSummary(null);}).finally(()=>{if(n===request.current)setSummaryLoading(false);});
 },[user,date]);
 useEffect(()=>{reloadSummary();},[reloadSummary,tick]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const t=e.target as HTMLElement|null;if(t?.matches('input,textarea,select')||t?.isContentEditable||e.metaKey||e.ctrlKey)return;if(e.key==='[')changeDate(shiftDate(date,-1));if(e.key===']')changeDate(shiftDate(date,1));if(e.key.toLowerCase()==='t')changeDate(today);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[date,today]);
 if(loading)return <div className="app-loading">Opening your day…</div>;
 if(!user)return <div className="app auth-app"><header className="brand-header"><span className="brand"><CircleDot size={24}/>lifelog<span className="version">2.1</span></span><button className="icon-btn" aria-label="Toggle theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}><Sun size={18}/></button></header><div className="auth-intro"><p className="eyebrow">YOUR ENERGY. YOUR DAY.</p><h1>A day that works<br/>with you.</h1><p>Not another list to keep up with. A plan that meets you where you are.</p></div><AuthScreen/></div>;
 const current=summary?.date===date?summary:null;
 return <div className="app app-v21">
  <header className="brand-header">
   <button className="brand" onClick={()=>navigate('dashboard')} aria-label="LifeLog home"><CircleDot size={26} strokeWidth={2.5}/>lifelog<span className="version">2.1</span></button>
   <nav className="primary-nav" aria-label="Main navigation">{NAV.map(({id,label,icon:Icon})=><button key={id} className={activeTab===id?'selected':''} onClick={()=>navigate(id)} aria-current={activeTab===id?'page':undefined}><Icon size={17}/><span>{label}</span></button>)}</nav>
   <div className="header-actions"><button className="icon-btn" aria-label={theme==='dark'?'Use light theme':'Use dark theme'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button><div className="more-wrap"><button className="more-btn" aria-expanded={more} onClick={()=>setMore(!more)}>More<ChevronDown size={15}/></button>{more&&<div className="more-menu"><p>{user.displayName||user.email}</p><button onClick={()=>navigate('health')}><Utensils size={16}/>Body & fuel</button><button onClick={()=>navigate('account')}><Settings size={16}/>Account & export</button><button onClick={()=>{void logout();setMore(false);}}><LogOut size={16}/>Log out</button></div>}</div></div>
  </header>
  <div className="workspace-content">
   <div className="page-heading"><div><p className="eyebrow">{activeTab==='dashboard'?'MAKE TODAY YOURS':NAV.find(n=>n.id===activeTab)?.label ?? 'YOUR SPACE'}</p><h1>{TITLES[activeTab][0]}</h1><p>{TITLES[activeTab][1]}</p></div>{activeTab!=='dashboard'&&<button className="quiet-link" onClick={()=>navigate('dashboard')}>Your plan<ArrowUpRight size={16}/></button>}</div>
   <DateStrip date={date} today={today} onChange={changeDate}/>
   <div className="global-capture"><OmniBar date={date}/></div>
   <main className="main-content">
    {activeTab==='dashboard'&&<TodayView key={date} date={date} today={today} data={current} loading={summaryLoading} onNavigate={navigate}/>}
    {activeTab==='agenda'&&<AgendaView key={date} date={date} today={today} summary={current} onChanged={reloadSummary}/>}
    {activeTab==='habits'&&<HabitPanel key={date} date={date} onChanged={reloadSummary}/>}
    {activeTab==='insights'&&<Dashboard key={date} initialRange="week" date={date} today={today} data={current} loading={summaryLoading} onNavigate={navigate}/>}
    {activeTab==='health'&&<HealthHub key={date} date={date} onChanged={reloadSummary}/>}
    {activeTab==='journal'&&<JournalPanel key={date} date={date} summary={current}/>}
    {activeTab==='account'&&<AccountPanel/>}
   </main>
  </div>
 </div>;
}
export default function App(){return <RefreshProvider><Shell/></RefreshProvider>;}
