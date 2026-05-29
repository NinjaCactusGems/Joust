import { useId, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { howToPlayRules } from '../i18n/richText';

// Collapsible "How to play" disclosure shown between the title and the lobby.
// Tapping the header toggles a panel that explains the rules.
export function HowToPlay() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rules = howToPlayRules[locale];

  return (
    <div className="w-full max-w-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 rounded-2xl border border-line bg-paper-raised/80 px-5 py-3 text-left active:scale-[0.99] transition"
      >
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-paper font-serif font-bold"
        >
          ?
        </span>
        <span className="flex-1 text-sm font-semibold uppercase tracking-wider text-ink-muted">
          {t('howToPlay.title')}
        </span>
        <span
          aria-hidden="true"
          className={`text-ink-muted transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▾
        </span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="mt-2 rounded-2xl border border-line bg-paper-raised/80 px-5 py-4 text-sm leading-relaxed text-ink"
      >
        <p className="text-ink-muted">{t('howToPlay.intro')}</p>
        <ol className="mt-3 flex flex-col gap-3.5">
          {rules.map((rule, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4;
            return (
              <li key={n} className="flex gap-2.5">
                <span className="font-serif font-bold text-accent">{n}.</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span>{rule()}</span>
                  <BulletFigure n={n} />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// Faint humanoid figures illustrating each rule. Decorative only (aria-hidden);
// the ink figures sit soft under the text, while the green/red phones in #3 are
// drawn in the game's olive/eliminated colours so the core mechanic reads.
function BulletFigure({ n }: { n: 1 | 2 | 3 | 4 }) {
  const base = {
    viewBox: '0 0 96 44',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const ink = 'h-9 w-auto text-ink opacity-40';

  // 1) Standing steady: both arms curved out holding a small phone; the head is
  // a calm eighth note.
  if (n === 1) {
    return (
      <svg {...base} className={ink}>
        <line x1="24" y1="40" x2="72" y2="40" />
        <NoteHead cx={40} cy={13} r={5} dir={-1} />
        <line x1="40" y1="18" x2="40" y2="30" />
        <line x1="40" y1="30" x2="35" y2="40" />
        <line x1="40" y1="30" x2="45" y2="40" />
        {/* arms sweep out into a wide welcoming arc — one hand keeps rivals at
            distance, the other holds the phone away from the body */}
        <path d="M40 21 q-14 -1 -24 -9" />
        <path d="M40 21 q14 -1 24 -9" />
        <rect x="61" y="7" width="6" height="11" rx="1.5" />
      </svg>
    );
  }
  // 2) Dance & weave: two players sizing each other up — one near (larger), one
  // further back (smaller), facing each other, heads as eighth notes.
  if (n === 2) {
    return (
      <svg {...base} className={ink}>
        {/* background player — smaller, set back, facing right, arms open */}
        <NoteHead cx={20} cy={15} r={3.5} dir={-1} />
        <line x1="20" y1="18.5" x2="20" y2="27" />
        <line x1="20" y1="27" x2="16" y2="34" />
        <line x1="20" y1="27" x2="24" y2="34" />
        <path d="M20 20 q-6 -1 -10 -5" />
        <path d="M20 20 q6 -1 10 -5" />
        {/* foreground player — larger, facing left, same wide welcome pose */}
        <NoteHead cx={66} cy={12} r={5.5} dir={1} />
        <line x1="66" y1="17.5" x2="66" y2="32" />
        <line x1="66" y1="32" x2="60" y2="42" />
        <line x1="66" y1="32" x2="72" y2="42" />
        <path d="M66 21 q-12 -1 -22 -8" />
        <path d="M66 21 q12 -1 22 -8" />
      </svg>
    );
  }
  // 3) Tap a rival: a calm olive-screen phone, and a red-screen one whose arm
  // was tapped — vibration swirling around it (the "you're out" moment).
  if (n === 3) {
    return (
      <svg {...base} className="h-10 w-auto text-ink opacity-90">
        {/* still in: arm holding an olive-screen phone */}
        <path d="M12 42 q3 -12 12 -17" />
        <rect x="20" y="11" width="13" height="17" rx="2.5" />
        <rect x="22.5" y="13.5" width="8" height="12" rx="1" fill="var(--color-olive)" stroke="none" />
        {/* out: arm holding a red-screen phone, just tapped, buzzing */}
        <path d="M58 42 q3 -12 12 -17" />
        <rect x="66" y="11" width="13" height="17" rx="2.5" />
        <rect x="68.5" y="13.5" width="8" height="12" rx="1" fill="var(--color-eliminated)" stroke="none" />
        {/* a rival's arm reaching in to tap the red-phone forearm */}
        <path d="M94 40 q-15 0 -31 -8" />
        {/* vibration swirls around the red phone */}
        <path d="M62 9 q-3 3 0 7" />
        <path d="M83 9 q3 3 0 7" />
        <path d="M59 19 q-3 1 -4 4" />
        <path d="M86 19 q3 1 4 4" />
      </svg>
    );
  }
  // 4) The last one standing, arms raised in celebration.
  return (
    <svg {...base} className={ink}>
      <line x1="30" y1="40" x2="66" y2="40" />
      <NoteHead cx={48} cy={11} r={5} dir={-1} />
      <line x1="48" y1="16" x2="48" y2="30" />
      <line x1="48" y1="30" x2="43" y2="40" />
      <line x1="48" y1="30" x2="53" y2="40" />
      {/* both arms as one connected stroke through the shoulders, raised */}
      <path d="M40 8 L48 19 L56 8" />
    </svg>
  );
}

// A figure's head drawn as an eighth note: the filled knob is the head, a stem
// rises from the crown, and the flag swirls back down like a lock of hair.
// `dir` points the swirl toward the figure's back (-1 = left, 1 = right).
function NoteHead({
  cx,
  cy,
  r,
  dir,
}: {
  cx: number;
  cy: number;
  r: number;
  dir: 1 | -1;
}) {
  const stemX = cx + dir * (r - 0.5); // rises from the side of the knob
  const stemTop = cy - 2 * r; // where the hair tuft peaks
  const s = r / 5; // scale the flag to the head size
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
      <line x1={stemX} y1={cy} x2={stemX} y2={stemTop} />
      <path
        d={`M${stemX} ${stemTop} c ${dir * 6 * s} ${s} ${dir * 8 * s} ${5 * s} ${dir * 4 * s} ${10 * s}`}
      />
    </>
  );
}
