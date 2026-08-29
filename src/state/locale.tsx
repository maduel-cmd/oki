import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import i18n, { type AppLocale, dirForLocale } from '@oki/i18n';

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  dir: 'rtl' | 'ltr';
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = 'oki.locale';

function readStored(): AppLocale | null {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'he' || v === 'ar' || v === 'en') return v;
  return null;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(
    () => readStored() ?? 'he',
  );

  // Keep i18n in sync on mount (browser lang may be en; product default is he).
  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = dirForLocale(locale);
  }, [locale]);

  const setLocale = useCallback(async (next: AppLocale) => {
    await i18n.changeLanguage(next);
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      dir: dirForLocale(locale),
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale requires LocaleProvider');
  return ctx;
}
