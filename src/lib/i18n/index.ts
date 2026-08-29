import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
import he from './locales/he.json';

export type AppLocale = 'he' | 'ar' | 'en';

export const SUPPORTED_LOCALES: AppLocale[] = ['he', 'ar', 'en'];

export function dirForLocale(locale: AppLocale): 'rtl' | 'ltr' {
  return locale === 'en' ? 'ltr' : 'rtl';
}

export function isAppLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

let initialized = false;

/** Init i18n once — Hebrew default, ar/en available. */
export function initOkiI18n(preferred?: string): typeof i18n {
  if (!initialized) {
    const lng =
      preferred && isAppLocale(preferred)
        ? preferred
        : typeof navigator !== 'undefined' && isAppLocale(navigator.language.slice(0, 2))
          ? (navigator.language.slice(0, 2) as AppLocale)
          : 'he';

    void i18n.use(initReactI18next).init({
      resources: {
        he: { translation: he },
        ar: { translation: ar },
        en: { translation: en },
      },
      lng,
      fallbackLng: 'he',
      interpolation: { escapeValue: false },
    });
    initialized = true;
  }
  return i18n;
}

export default i18n;
