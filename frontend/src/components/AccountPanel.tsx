import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { updateProfile, changePassword, deleteAccount, exportAll, getPushStatus, getVapidKey, subscribePush, testPush, unsubscribePush } from '../api';

function extractErrorMessage(err: unknown, fallback: string): string {
  const maybeAxiosError = err as { response?: { data?: { error?: string } } };
  return maybeAxiosError.response?.data?.error ?? fallback;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Evening reminder via standard Web Push (works in Chrome/Edge/Firefox and in iOS 16.4+ once the
// app is on the Home Screen). One nudge a day at the user's chosen local time.
function RemindersCard() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const [time, setTime] = useState('20:30');
  const [status, setStatus] = useState<'idle' | 'working' | 'on' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [subs, setSubs] = useState<Array<{ id: number; reminder_hour: number; reminder_minute: number }>>([]);

  const load = () => getPushStatus().then((r) => { setSubs(r.data); if (r.data.length) setStatus('on'); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const enable = async () => {
    setStatus('working');
    setMessage('');
    try {
      if (!supported) throw new Error('This browser cannot receive web push.');
      if (isIOS && !standalone) throw new Error('On iPhone, add LifeLog to your Home Screen first (Share → Add to Home Screen), then enable reminders from that icon.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed.');
      const reg = await navigator.serviceWorker.ready;
      const { data } = await getVapidKey();
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.publicKey) });
      const [h, m] = time.split(':').map(Number);
      await subscribePush({ subscription: sub.toJSON(), reminderHour: h, reminderMinute: m, tzOffsetMinutes: -new Date().getTimezoneOffset() });
      setStatus('on');
      setMessage(`Evening nudge set for ${time}. You can test it below.`);
      await load();
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Could not enable reminders.');
    }
  };

  const disable = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await unsubscribePush(sub?.endpoint);
      await sub?.unsubscribe();
    } catch { /* ignore */ }
    setSubs([]);
    setStatus('idle');
    setMessage('Reminders off.');
  };

  return (
    <div className="card">
      <div className="card-title">🔔 Evening reminder</div>
      <p className="grocery-section-copy" style={{ marginBottom: 10 }}>
        One nudge a day, at the time you pick: “Close your day: mood, one win, tomorrow’s top task.” Nothing else, ever.
        {isIOS && !standalone ? ' On iPhone this works once LifeLog is on your Home Screen.' : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="time" className="btn-xs" value={time} onChange={(e) => setTime(e.target.value)} />
        {status !== 'on' ? (
          <button type="button" className="btn-sm blue" onClick={enable} disabled={status === 'working'}>{status === 'working' ? 'Enabling…' : 'Enable reminders'}</button>
        ) : (
          <>
            <button type="button" className="btn-sm" onClick={() => testPush().then((r) => setMessage(r.data.sent ? 'Test sent. Check your notifications.' : 'No active subscription on the server yet.'))}>Send a test</button>
            <button type="button" className="btn-sm red" onClick={disable}>Turn off</button>
          </>
        )}
      </div>
      {subs.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Active on {subs.length} device{subs.length === 1 ? '' : 's'} · {String(subs[0].reminder_hour).padStart(2, '0')}:{String(subs[0].reminder_minute).padStart(2, '0')} local time.</p>}
      {message && <p className={status === 'error' ? 'omni-error' : 'saved-note'} style={{ marginTop: 8 }}>{message}</p>}
    </div>
  );
}

export default function AccountPanel() {
  const { user, logout, refreshUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileStatus, setProfileStatus] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileStatus('');
    setProfileError('');
    try {
      await updateProfile({ displayName });
      await refreshUser();
      setProfileStatus('Saved');
      setTimeout(() => setProfileStatus(''), 2000);
    } catch (err) {
      setProfileError(extractErrorMessage(err, 'Could not update profile.'));
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordStatus('');
    setPasswordError('');
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordStatus('Password updated');
      setTimeout(() => setPasswordStatus(''), 2000);
    } catch (err) {
      setPasswordError(extractErrorMessage(err, 'Could not change password.'));
    }
  };

  const confirmDelete = async (e: FormEvent) => {
    e.preventDefault();
    setDeleteError('');
    try {
      await deleteAccount({ password: deletePassword });
      await logout();
    } catch (err) {
      setDeleteError(extractErrorMessage(err, 'Could not delete account.'));
    }
  };

  return (
    <div className="panel">
      <h2>Account</h2>

      <div className="card">
        <div className="card-title">👤 Profile</div>
        <form onSubmit={saveProfile} className="auth-form">
          <label>Email</label>
          <input className="input" value={user.email} disabled />
          <label>Display name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
          />
          {profileError && <div className="grocery-banner error">{profileError}</div>}
          <button type="submit" className="btn-primary">
            {profileStatus || 'Save profile'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-title">🔒 Change password</div>
        <form onSubmit={savePassword} className="auth-form">
          <input
            className="input"
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <input
            className="input"
            type="password"
            placeholder="New password (min 8 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          {passwordError && <div className="grocery-banner error">{passwordError}</div>}
          <button type="submit" className="btn-primary">
            {passwordStatus || 'Change password'}
          </button>
        </form>
      </div>

      <RemindersCard />

      <div className="card">
        <div className="card-title">📦 Your data</div>
        <p className="grocery-section-copy" style={{ marginBottom: 10 }}>Everything you have ever logged, as one JSON file. Free forever, no lock-in.</p>
        <button
          type="button"
          className="btn-sm blue"
          onClick={async () => {
            const res = await exportAll();
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lifelog-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export all my data
        </button>
      </div>

      <div className="card">
        <div className="card-title">🚪 Session</div>
        <button type="button" className="btn-sm" onClick={() => logout()}>
          Log out
        </button>
      </div>

      <div className="card">
        <div className="card-title">⚠️ Delete account</div>
        {!deleteConfirm ? (
          <button type="button" className="btn-sm red" onClick={() => setDeleteConfirm(true)}>
            Delete my account
          </button>
        ) : (
          <form onSubmit={confirmDelete} className="auth-form">
            <p className="grocery-section-copy">
              This permanently deletes your account and all of your data (tasks, habits, logs, journal). Enter your password to confirm.
            </p>
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {deleteError && <div className="grocery-banner error">{deleteError}</div>}
            <div className="grocery-actions">
              <button type="submit" className="btn-sm red">Confirm delete</button>
              <button type="button" className="btn-sm" onClick={() => { setDeleteConfirm(false); setDeletePassword(''); setDeleteError(''); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
