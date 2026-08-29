import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createOkiClient, type OkiClient } from '@oki/api';
import type { Session, User } from '@supabase/supabase-js';

type AuthContextValue = {
  client: OkiClient | null;
  session: Session | null;
  user: User | null;
  configured: boolean;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function env(name: string): string | undefined {
  const v = import.meta.env[name] as string | undefined;
  return v && !v.includes('YOUR_PROJECT') && v.length > 0 ? v : undefined;
}

function authRedirectTo(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin;
    }
  }
  const fromEnv = import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined;
  if (fromEnv?.startsWith('http')) return fromEnv.replace(/\/$/, '');
  return window.location.origin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  const configured = Boolean(url && anon);

  const client = useMemo(() => {
    if (!url || !anon) return null;
    return createOkiClient({ url, anonKey: anon, disableRealtime: false });
  }, [url, anon]);

  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configured);

  useEffect(() => {
    if (!client) {
      setSession(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = client.auth.onAuthStateChange((_e, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      client,
      session,
      user: session?.user ?? null,
      configured,
      ready,
      signIn: async (email, password) => {
        if (!client) throw new Error('supabase_missing');
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signUp: async (email, password, displayName) => {
        if (!client) throw new Error('supabase_missing');
        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: authRedirectTo(),
          },
        });
        if (error) throw error;
      },
      signOut: async () => {
        if (!client) return;
        await client.auth.signOut();
      },
    }),
    [client, session, configured, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
