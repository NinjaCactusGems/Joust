import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { dict, type Locale, type TranslationKey } from './translations';

const LOCALE_KEY = 'joust:locale';

// Stored preference wins; otherwise fall back to the browser/OS language
// (any de* variant → German), then English.
function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LOCALE_KEY);
  if (stored === 'en' || stored === 'de') return stored;
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // Keep <html lang> in sync for accessibility and correct hyphenation.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_KEY, next);
    }
  }, []);

  const t = useCallback<I18nContextValue['t']>(
    (key, params) => {
      let str = dict[locale][key] ?? dict.en[key] ?? key;
      if (params) {
        for (const param in params) {
          str = str.replaceAll(`{${param}}`, String(params[param]));
        }
      }
      return str;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
