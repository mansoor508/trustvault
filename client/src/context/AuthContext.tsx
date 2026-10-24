import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  registerCompany as registerCompanyRequest,
  type AuthSession,
  type AuthUser,
} from '../lib/auth';
import { extractErrorMessage } from '../lib/auth';
import { setUnauthorizedHandler } from '../lib/session-events';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

export interface LoginOutcome {
  ok: boolean;
  message?: string;
  user?: AuthUser;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  /** Kept in memory only; never written to localStorage. */
  csrfToken: string | null;
  notice: string | null;
  login: (email: string, password: string, inviteToken?: string) => Promise<LoginOutcome>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    companyName?: string;
    inviteToken?: string;
  }) => Promise<LoginOutcome>;
  registerCompany: (input: {
    name: string;
    email: string;
    password: string;
    companyName?: string;
    inviteToken?: string;
  }) => Promise<LoginOutcome>;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
  /** Called by the API layer when a session is no longer valid. */
  expireSession: (message?: string) => void;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EXPIRED_MESSAGE =
  'Your session expired or was revoked. Sign in again to continue.';

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearSessionState = useCallback(() => {
    setUser(null);
    setSession(null);
    setStatus('anonymous');
  }, []);

  const expireSession = useCallback(
    (message: string = SESSION_EXPIRED_MESSAGE) => {
      setNotice(message);
      clearSessionState();
      navigate('/login', { replace: true });
    },
    [clearSessionState, navigate],
  );

  // The API client calls this on any 401 from an authenticated endpoint.
  useEffect(() => {
    setUnauthorizedHandler(() => expireSession());
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);

  // Restore the session from the HttpOnly cookie on first load.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchMe();
        if (cancelled) return;

        if (result.ok) {
          setUser(result.data.user);
          setSession(result.data.session);
          setStatus('authenticated');
        } else {
          setStatus('anonymous');
        }
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, inviteToken?: string): Promise<LoginOutcome> => {
      try {
        const result = await loginRequest(email, password, inviteToken);
      if (!result.ok) {
        return {
          ok: false,
          message: extractErrorMessage(result.data) ?? `Sign-in failed (HTTP ${result.status}).`,
        };
      }
      setUser(result.data.user);
      setSession(result.data.session);
      setNotice(null);
      setStatus('authenticated');
      return { ok: true, user: result.data.user };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not reach the API.',
      };
    }
  }, []);

  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
      companyName?: string;
      inviteToken?: string;
    }): Promise<LoginOutcome> => {
      try {
        const result = await registerCompanyRequest(input);
        if (!result.ok) {
          return {
            ok: false,
            message: extractErrorMessage(result.data) ?? `Registration failed (HTTP ${result.status}).`,
          };
        }
        setUser(result.data.user);
        setSession(result.data.session);
        setNotice(null);
        setStatus('authenticated');
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Could not reach the API.',
        };
      }
    },
    [],
  );

  const registerCompany = register;

  const logout = useCallback(async () => {
    const token = session?.csrfToken;
    try {
      if (token !== undefined) await logoutRequest(token);
    } catch {
      // Server-side revocation failed; clearing the cookie is the browser's job.
    } finally {
      clearSessionState();
      setNotice('You have been signed out.');
      navigate('/login', { replace: true });
    }
  }, [clearSessionState, navigate, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      csrfToken: session?.csrfToken ?? null,
      notice,
      login,
      register,
      registerCompany,
      setUser,
      logout,
      expireSession,
      clearNotice: () => setNotice(null),
    }),
    [status, user, session, notice, login, registerCompany, logout, expireSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
