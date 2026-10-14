import { useQueryClient } from '@tanstack/react-query';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/apiClient';
import { auth, usingEmulators } from '../../lib/firebase';

export interface Profile {
  uid: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL: string | null;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; user: User; profile: Profile | null };

interface AuthContextValue {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** iOS PWAs in standalone mode cannot open popups reliably (research R10). */
function prefersRedirect(): boolean {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();
  const synced = useRef(new Set<string>());

  useEffect(() => {
    getRedirectResult(auth).catch(() => setState({ status: 'signedOut', error: 'No se pudo iniciar sesión.' }));
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        setState((s) => (s.status === 'signedOut' ? s : { status: 'signedOut' }));
        return;
      }
      setState({ status: 'signedIn', user, profile: null });
      if (synced.current.has(user.uid)) return;
      synced.current.add(user.uid);
      api<{ user: Profile }>('POST', '/me/sync')
        .then(({ user: profile }) =>
          setState((s) => (s.status === 'signedIn' && s.user.uid === user.uid ? { ...s, profile } : s)),
        )
        .catch(() => synced.current.delete(user.uid));
    });
  }, []);

  const signIn = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      if (prefersRedirect()) await signInWithRedirect(auth, provider);
      else await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setState({ status: 'signedOut', error: 'No se pudo iniciar sesión con Google.' });
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    synced.current.clear();
    queryClient.clear();
  }, [queryClient]);

  // E2E hook: only exists when running against the emulators (never in production builds).
  useEffect(() => {
    if (!usingEmulators) return;
    const w = window as unknown as { __e2eSignIn?: (email: string, name: string) => Promise<void> };
    w.__e2eSignIn = async (email, name) => {
      const credential = GoogleAuthProvider.credential(
        JSON.stringify({ sub: `e2e-${email}`, email, email_verified: true, name }),
      );
      await signInWithCredential(auth, credential);
    };
    return () => {
      delete w.__e2eSignIn;
    };
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Signed-in user; only call below RequireAuth. */
export function useCurrentUser(): { user: User; profile: Profile | null } {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useCurrentUser requires a signed-in user');
  return { user: state.user, profile: state.profile };
}
