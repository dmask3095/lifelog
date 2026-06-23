import axios from 'axios';

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

export const getTasks = (date: string) => api.get(`/tasks?date=${date}`);
export const createTask = (data: object) => api.post('/tasks', data);
export const updateTask = (id: number, data: object) => api.patch(`/tasks/${id}`, data);
export const deleteTask = (id: number) => api.delete(`/tasks/${id}`);

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
