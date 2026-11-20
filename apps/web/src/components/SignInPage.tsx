import { useEffect, useState, type FormEvent } from 'react';
import { SignInError, useAuth } from '../auth';
import { Link, navigate, safeNext } from '../router';
import { Icon } from './Icon';

type Mode = 'signin' | 'signup' | 'reset';

const TITLE: Record<Mode, string> = { signin: 'Sign in', signup: 'Create your account', reset: 'Reset your password' };
const SUBMIT: Record<Mode, [idle: string, busy: string]> = {
  signin: ['Sign in', 'Signing in…'],
  signup: ['Create account', 'Creating your account…'],
  reset: ['Send reset link', 'Sending…'],
};

const BENEFITS = [
  { icon: 'save', title: 'Save stories', text: 'Keep them for later, on your phone and your laptop.' },
  { icon: 'history', title: 'Your history', text: "Everything you've read and watched, in one place." },
  { icon: 'check', title: "Only what's new", text: "Stories you've already read stay out of your feed." },
  { icon: 'spark', title: 'For you', text: 'A feed from the tech you use, and a daily digest if you want one.' },
] as const;

/** Sign in, create an account or reset a password. `next`: where to go afterwards. */
export function SignInPage({ next: rawNext }: { next: string | null }) {
  const auth = useAuth();
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Signed in (here, or already in another tab): carry on to where the reader was going.
  useEffect(() => {
    if (auth.user) navigate(next, { replace: true });
  }, [auth.user, next]);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof SignInError ? err.message : "Sign-in didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') void run(() => auth.signInWithEmail(email, password));
    else if (mode === 'signup') void run(() => auth.signUpWithEmail(name, email, password));
    else {
      void run(async () => {
        await auth.resetPassword(email);
        setNotice(`If there's an account for ${email.trim()}, a link to reset the password is on its way. Check your inbox.`);
      });
    }
  };

  if (!auth.enabled) {
    return (
      <div className="page">
        <div className="page-card">
          <h2 className="page-title">Accounts aren't available here</h2>
          <p className="hint">Sign-in isn't set up on this server yet, so saving, history and "For you" are turned off.</p>
          <Link className="primary" href="/">Read the news</Link>
        </div>
      </div>
    );
  }

  const [idle, working] = SUBMIT[mode];
  return (
    <div className="page auth-page">
      <section className="auth-intro" aria-labelledby="auth-intro-title">
        <h2 id="auth-intro-title" className="auth-pitch">Tech news that remembers where you left off.</h2>
        <p className="hint">A free account. Nothing to install.</p>
        <ul className="benefits">
          {BENEFITS.map((b) => (
            <li key={b.title}>
              <span className="benefit-icon"><Icon name={b.icon} size={18} /></span>
              <div>
                <strong>{b.title}</strong>
                <span>{b.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <h2 id="auth-title" className="page-title">{TITLE[mode]}</h2>
        {mode === 'reset' ? (
          <p className="hint">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
        ) : (
          <>
            <button type="button" className="google" disabled={busy || !auth.ready} onClick={() => void run(auth.signInWithGoogle)}>
              <GoogleMark />
              Continue with Google
            </button>
            <p className="or"><span>or use your email</span></p>
          </>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <label className="form-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} />
            </label>
          )}
          <label className="form-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          {mode !== 'reset' && (
            <div className="form-field">
              <span className="form-label-row">
                <label htmlFor="password">Password</label>
                {mode === 'signin' && (
                  <button type="button" className="text-button" onClick={() => switchTo('reset')}>Forgot password?</button>
                )}
              </span>
              <span className="password">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  aria-describedby={mode === 'signup' ? 'password-rule' : undefined}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                </button>
              </span>
              {mode === 'signup' && <span id="password-rule" className="hint">At least 8 characters.</span>}
            </div>
          )}
          <button type="submit" className="primary" disabled={busy || !auth.ready}>
            {busy ? working : idle}
          </button>
        </form>

        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="status" role="status">{notice}</p>

        <p className="auth-switch">
          {mode === 'signin' && (
            <>New to TechNews? <button type="button" className="text-button" onClick={() => switchTo('signup')}>Create an account</button></>
          )}
          {mode === 'signup' && (
            <>Already have an account? <button type="button" className="text-button" onClick={() => switchTo('signin')}>Sign in</button></>
          )}
          {mode === 'reset' && <button type="button" className="text-button" onClick={() => switchTo('signin')}>Back to sign in</button>}
        </p>
        <Link className="auth-skip" href={next}>Continue without an account</Link>
      </section>
    </div>
  );
}

/** Google's "G", as its sign-in button guidelines ask for. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
