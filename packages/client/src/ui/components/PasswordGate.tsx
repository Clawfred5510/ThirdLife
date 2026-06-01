import React, { useState, useCallback, useRef, useEffect } from 'react';
import { loginGate } from '../../network/siteGate';

interface Props {
  onSuccess: () => void;
}

/**
 * Full-screen username/password gate shown before anything else while
 * ThirdLife is in private testing. Credentials are checked server-side
 * (api/site-gate.ts) — this screen only collects them and stores the returned
 * gate token. On success it calls onSuccess() to reveal the Play screen.
 *
 * i18n: strings grouped here; localization is project-wide TODO.
 */
export const PasswordGate: React.FC<Props> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => { userRef.current?.focus(); }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await loginGate(username.trim(), password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message || 'Login failed');
      setBusy(false);
    }
  }, [username, password, busy, onSuccess]);

  return (
    <div style={S.screen} role="dialog" aria-modal="true" aria-label="Sign in to access ThirdLife (private testing)">
      <form style={S.panel} onSubmit={submit}>
        <div style={S.brand}>ThirdLife</div>
        <div style={S.sub}>Private testing — sign in to continue</div>

        <label style={S.label} htmlFor="gate-user">Username</label>
        <input
          id="gate-user"
          ref={userRef}
          style={S.input}
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
        />

        <label style={S.label} htmlFor="gate-pass">Password</label>
        <input
          id="gate-pass"
          style={S.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error && <div style={S.error} role="alert">{error}</div>}

        <button style={{ ...S.button, opacity: busy ? 0.6 : 1 }} type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
};

const S: Record<string, React.CSSProperties> = {
  screen: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: '#0b0d10',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'auto',
    padding: 20,
    fontFamily: '"Nunito", system-ui, sans-serif',
  },
  panel: {
    width: 340, maxWidth: '92vw',
    background: '#1b1f27', color: '#F5E6D0',
    border: '1px solid rgba(216,148,56,0.35)', borderRadius: 16,
    padding: 24, boxShadow: '0 16px 50px rgba(0,0,0,0.55)',
    display: 'flex', flexDirection: 'column',
  },
  brand: { fontSize: 28, fontWeight: 800, fontFamily: '"Fraunces", Georgia, serif', letterSpacing: 0.5 },
  sub: { fontSize: 13, opacity: 0.7, marginTop: 4, marginBottom: 18 },
  label: { fontSize: 12, fontWeight: 700, opacity: 0.8, marginBottom: 6, marginTop: 12 },
  input: {
    width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 14,
    background: 'rgba(255,255,255,0.06)', color: '#F5E6D0',
    border: '1px solid rgba(255,255,255,0.16)', outline: 'none',
  },
  error: { marginTop: 12, fontSize: 12, color: '#f87171', lineHeight: 1.4 },
  button: {
    marginTop: 20, width: '100%', padding: '11px 12px', borderRadius: 10,
    background: '#D89438', color: '#1b1108', border: 'none',
    cursor: 'pointer', fontSize: 15, fontWeight: 800, fontFamily: '"Nunito", system-ui, sans-serif',
  },
};
