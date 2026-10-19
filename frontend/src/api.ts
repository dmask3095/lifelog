import axios from 'axios';
import type { HabitTier, OmniResult, RangeData, SummaryData, Task, HabitWithStreak, Hurdle, TimeCategory } from './types';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const baseURL = configuredBaseUrl && configuredBaseUrl.length > 0
  ? configuredBaseUrl.replace(/\/$/, '')
  : 'http://localhost:3001/api';

export const api = axios.create({ baseURL, withCredentials: true });

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

// ---- summary & insights -----------------------------------------------------
export const getSummary = (date: string) => api.get<SummaryData>(`/summary/${date}`);
export const getRange = (start: string, end: string) => api.get<RangeData>('/summary/range', { params: { start, end } });

// ---- omni-bar ---------------------------------------------------------------
export const omniLog = (text: string, date: string, commit: boolean) =>
  api.post<OmniResult>('/omni-log', { text, date, commit });

// ---- tasks ------------------------------------------------------------------
export const getTasks = (date: string) => api.get<Task[]>(`/tasks?date=${date}`);
export const getSomedayTasks = () => api.get<Task[]>('/tasks/someday');
export const createTask = (data: object) => api.post<Task>('/tasks', data);
export const updateTask = (id: number, data: object) => api.patch<Task>(`/tasks/${id}`, data);
export const deleteTask = (id: number) => api.delete(`/tasks/${id}`);
export const splitTask = (id: number, steps: string[], date: string) => api.post<Task[]>(`/tasks/${id}/split`, { steps, date });

// ---- hurdles ----------------------------------------------------------------
export const getTaskHurdles = (taskId: number) => api.get<Hurdle[]>(`/hurdles/task/${taskId}`);
export const createHurdle = (task_id: number, description: string) => api.post<Hurdle>('/hurdles', { task_id, description });
export const resolveHurdle = (id: number, resolution?: string) => api.patch<Hurdle>(`/hurdles/${id}`, { resolution });

// ---- habits -----------------------------------------------------------------
export const getHabitLog = (date: string) => api.get<HabitWithStreak[]>(`/habits/log/${date}`);
export const logHabit = (habit_id: number, date: string, completed: boolean, tier: HabitTier) =>
  api.post('/habits/log', { habit_id, date, completed, tier });
export const createHabit = (data: { name: string; icon?: string; floor_label?: string; target_label?: string; stretch_label?: string }) =>
  api.post('/habits', data);
export const updateHabit = (id: number, data: object) => api.patch(`/habits/${id}`, data);
export const deleteHabit = (id: number) => api.delete(`/habits/${id}`);

// ---- health / fuel ----------------------------------------------------------
export interface HealthRow { id: number; date: string; water_ml: number; fruits: string | null; food_notes: string | null; tags: string | null }
export const getLatestHealth = (date: string) => api.get<HealthRow | null>(`/health-logs/latest/${date}`);
export const saveHealth = (data: { date: string; water_ml?: number; add_water_ml?: number; fruits?: string; food_notes?: string; tags?: string[] }) =>
  api.post<HealthRow>('/health-logs', data);

// ---- mood -------------------------------------------------------------------
export interface MoodRow { id: number; date: string; score: number; note: string | null }
export const getLatestMood = (date: string) => api.get<MoodRow | null>(`/moods/latest/${date}`);
export const saveMood = (date: string, score: number, note: string) => api.post<MoodRow>('/moods', { date, score, note });

// ---- time -------------------------------------------------------------------
export interface TimeLogRow { id: number; date: string; category: TimeCategory; minutes: number; note: string | null }
export const getTimeLogs = (date: string) => api.get<TimeLogRow[]>(`/time-logs?date=${date}`);
export const putDailyTime = (date: string, category: TimeCategory, minutes: number, note?: string) =>
  api.put<TimeLogRow>('/time-logs/daily', { date, category, minutes, note });
export const postTime = (date: string, category: TimeCategory, minutes: number, note?: string) =>
  api.post<TimeLogRow>('/time-logs', { date, category, minutes, note });

// ---- journal ----------------------------------------------------------------
export interface JournalEntry { date: string; content: string; updated_at: string }
export const getJournal = (date: string) => api.get<JournalEntry | null>(`/journal/${date}`);
export const listJournal = () => api.get<JournalEntry[]>('/journal');
export const saveJournal = (date: string, content: string) => api.post<JournalEntry>('/journal', { date, content });

// ---- export -----------------------------------------------------------------
export const exportAll = () => api.get('/export');

// ---- auth -------------------------------------------------------------------
export interface UserProfile {
  id: number;
  email: string;
  displayName: string | null;
}

export const signup = (data: { email: string; password: string; displayName?: string }) =>
  api.post<UserProfile>('/auth/signup', data);
export const login = (data: { email: string; password: string }) =>
  api.post<UserProfile>('/auth/login', data);
export const logout = () => api.post('/auth/logout');
export const getMe = () => api.get<UserProfile>('/auth/me');
export const updateProfile = (data: { displayName?: string; email?: string }) =>
  api.patch<UserProfile>('/auth/me', data);
export const changePassword = (data: { currentPassword: string; newPassword: string }) =>
  api.post('/auth/change-password', data);
export const deleteAccount = (data: { password: string }) =>
  api.delete('/auth/me', { data });
