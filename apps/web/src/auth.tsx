import { useQueryClient } from '@tanstack/react-query';
// Sign-in state for the whole app. Firebase is loaded only when it's configured, as a separate chunk,
// so readers who never sign in don't download it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  photoUrl: string | null;
  provider: 'google' | 'password';
  createdAt: string | null; // when the account was made, from Firebase
}

interface AuthState {
  enabled: boolean; // false: sign-in isn't set up, so the app hides every account feature
  ready: boolean; // false until we know whether a session exists
  user: AuthUser | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  token: () => Promise<string>; // fresh Firebase ID token for API calls
}

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const testAuth = import.meta.env.DEV ? window.__TECHNEWS_TEST_AUTH__ : undefined;

const Ctx = createContext<AuthState | null>(null);

async function loadFirebase() {
  const [{ initializeApp }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(firebaseConfig);
  return { auth: auth.getAuth(app), lib: auth };
}

type FirebaseUser = import('firebase/auth').User;

function toAuthUser(u: FirebaseUser, name = u.displayName): AuthUser {
  return {
    uid: u.uid,
    name: name || u.email?.split('@')[0] || 'Reader',
    email: u.email,
    photoUrl: u.photoURL,
    provider: u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'password',
    createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
  };
}

/** A sign-in failure in words a reader can act on. */
export class SignInError extends Error {}

// Firebase errors carry a code like "auth/wrong-password".
const NO_MATCH = "That email and password don't match. Try again, or reset your password.";
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': NO_MATCH,
  'auth/wrong-password': NO_MATCH,
  'auth/user-not-found': NO_MATCH,
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-email': 'Enter your email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': "Can't reach the sign-in service. Check your connection and try again.",
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/operation-not-allowed': "Email sign-in isn't turned on for this app yet. Continue with Google instead.",
  'auth/account-exists-with-different-credential': 'This email already uses a different sign-in method. Try Continue with Google.',
  'auth/unauthorized-domain': "Sign-in isn't allowed on this address yet. The site owner needs to add it in Firebase.",
};
const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

/** Runs a sign-in call and turns Firebase errors into a SignInError. Closing the Google window is not an error. */
async function friendly(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (CANCELLED.has(code)) return;
    throw new SignInError(MESSAGES[code] ?? "Sign-in didn't work. Please try again.");
  }
}

function testUser(name: string, email: string, provider: AuthUser['provider']): AuthUser {
  return { uid: 'test-user', name, email, photoUrl: null, provider, createdAt: '2026-01-15T00:00:00.000Z' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(testAuth?.user ? testUser(testAuth.user.name, 'reader@example.com', 'google') : null);
  const [ready, setReady] = useState(Boolean(testAuth) || !firebaseConfigured);
  const [fb, setFb] = useState<Awaited<ReturnType<typeof loadFirebase>> | null>(null);

  useEffect(() => {
    if (testAuth || !firebaseConfigured) return;
    let unsubscribe = () => {};
    loadFirebase().then((loaded) => {
      setFb(loaded);
      unsubscribe = loaded.lib.onAuthStateChanged(loaded.auth, (u) => {
        void queryClient.cancelQueries();
        queryClient.clear();
        setUser(u ? toAuthUser(u) : null);
        setReady(true);
      });
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (testAuth) return setUser(testUser('Test Reader', 'reader@example.com', 'google'));
    if (!fb) return;
    await friendly(() => fb.lib.signInWithPopup(fb.auth, new fb.lib.GoogleAuthProvider()));
  }, [fb]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (testAuth) {
      if (password === 'wrong') throw new SignInError(NO_MATCH); // lets tests check the error message
      return setUser(testUser(email.split('@')[0], email, 'password'));
    }
    if (!fb) return;
    await friendly(() => fb.lib.signInWithEmailAndPassword(fb.auth, email.trim(), password));
  }, [fb]);

  const signUpWithEmail = useCallback(async (name: string, email: string, password: string) => {
    if (testAuth) return setUser(testUser(name, email, 'password'));
    if (!fb) return;
    await friendly(async () => {
      const { user: created } = await fb.lib.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
      await fb.lib.updateProfile(created, { displayName: name.trim() });
      setUser(toAuthUser(created, name.trim())); // the sign-in event fired before the name was set
    });
  }, [fb]);

  const resetPassword = useCallback(async (email: string) => {
    if (testAuth || !fb) return;
    await friendly(() => fb.lib.sendPasswordResetEmail(fb.auth, email.trim()));
  }, [fb]);

  const signOut = useCallback(async () => {
    // Remove this browser's notification subscription before another account uses it.
    if (fb?.auth.currentUser) {
      const { disablePush } = await import('./push');
      try { await disablePush(await fb.auth.currentUser.getIdToken()); }
      catch {
        // Stop local delivery even when the server is temporarily unavailable.
        const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
        await sub?.unsubscribe();
      }
    }
    void queryClient.cancelQueries();
    queryClient.clear();
    if (testAuth) return setUser(null);
    if (fb) await fb.lib.signOut(fb.auth);
  }, [fb]);

  const token = useCallback(async () => {
    if (testAuth) return 'test-token';
    const current = fb?.auth.currentUser;
    if (!current) throw new Error('Sign in first');
    return current.getIdToken(); // Firebase refreshes it when it's close to expiring
  }, [fb]);

  const value = useMemo(
    () => ({
      enabled: Boolean(testAuth) || firebaseConfigured,
      ready,
      user,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
      token,
    }),
    [ready, user, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut, token],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
