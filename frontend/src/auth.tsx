import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, clearSession, getToken, setSession } from "./api";
import type { AuthResult, Language, User } from "./types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (payload: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem("kc-user") || "null") as User | null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api.me().then((profile) => {
      setUser(profile);
      localStorage.setItem("kc-user", JSON.stringify(profile));
    }).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 0)) {
        clearSession();
        setUser(null);
      }
    }).finally(() => setLoading(false));
  }, []);

  const acceptSession = useCallback((result: AuthResult) => {
    setSession(result.access_token, result.user);
    setUser(result.user);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => acceptSession(await api.login(email, password)), [acceptSession]);
  const signUp = useCallback(async (payload: Record<string, unknown>) => acceptSession(await api.register(payload)), [acceptSession]);
  const signOut = useCallback(async () => {
    try { await api.logout(); } finally { clearSession(); setUser(null); }
  }, []);
  const setLanguage = useCallback(async (language: Language) => {
    if (user && navigator.onLine) {
      const updated = await api.updateLanguage(language);
      setUser(updated);
      localStorage.setItem("kc-user", JSON.stringify(updated));
    } else if (user) {
      const updated = { ...user, preferred_language: language };
      setUser(updated);
      localStorage.setItem("kc-user", JSON.stringify(updated));
    }
  }, [user]);

  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut, setLanguage }), [user, loading, signIn, signUp, signOut, setLanguage]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
