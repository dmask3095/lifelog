import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { updateProfile, changePassword, deleteAccount } from '../api';

function extractErrorMessage(err: unknown, fallback: string): string {
  const maybeAxiosError = err as { response?: { data?: { error?: string } } };
  return maybeAxiosError.response?.data?.error ?? fallback;
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
              This permanently deletes your account and all of your data (tasks, habits, logs, journal, groceries). Enter your password to confirm.
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
