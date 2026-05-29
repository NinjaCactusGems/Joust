import { useI18n } from '../i18n/I18nContext';
import { SUPPORTED, type Locale } from '../i18n/translations';

const LABELS: Record<Locale, string> = { en: 'EN', de: 'DE' };

// Compact segmented EN/DE pill, anchored top-right of the main screen.
export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex rounded-full border border-line bg-paper-raised/80 p-0.5"
    >
      {SUPPORTED.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
            locale === l ? 'bg-ink text-paper' : 'text-ink-muted'
          }`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
