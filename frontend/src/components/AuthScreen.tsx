import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

function extractErrorMessage(err: unknown, fallback: string): string {
  const maybeAxiosError = err as { response?: { data?: { error?: string } } };
  return maybeAxiosError.response?.data?.error ?? fallback;
}

export default function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await signup(email, password, displayName || undefined);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Something went wrong. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="content">
      <div className="card auth-card">
        <div className="card-title">{mode === 'login' ? '👋 Welcome back' : '✨ Create your account'}</div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && (
            <input
              className="input"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="input"
            type="password"
            placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
          {error && <div className="grocery-banner error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
