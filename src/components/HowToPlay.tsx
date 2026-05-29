import { useId, useState } from 'react';

// Collapsible "How to play" disclosure shown between the title and the lobby.
// Tapping the header toggles a panel that explains the rules.
export function HowToPlay() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

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
          How to play
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
        <p className="text-ink-muted">
          Joust is a game of movement and balance — played in the real world,
          phone in hand.
        </p>
        <ol className="mt-3 flex flex-col gap-3.5">
          <li className="flex gap-2.5">
            <span className="font-serif font-bold text-accent">1.</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span>
                Hold your phone out, <strong>away from your body</strong>, and
                keep it steady.
              </span>
              <BulletFigure n={1} />
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-serif font-bold text-accent">2.</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span>
                <strong>Dance and weave</strong> around the other players
                without jostling your own phone.
              </span>
              <BulletFigure n={2} />
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-serif font-bold text-accent">3.</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span>
                Make rivals move too quickly — a{' '}
                <strong>touch on the arm</strong> is fair game. Move your phone
                too fast and you're out.
              </span>
              <BulletFigure n={3} />
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-serif font-bold text-accent">4.</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span>
                Be the <strong>last one standing</strong> to win the joust.
              </span>
              <BulletFigure n={4} />
            </span>
          </li>
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
  const eye = { r: 1.3, fill: 'currentColor', stroke: 'none' };

  // 1) Standing steady: both arms curved out holding a small phone, eye looking
  // forward rather than down at the screen.
  if (n === 1) {
    return (
      <svg {...base} className={ink}>
        <line x1="26" y1="40" x2="70" y2="40" />
        <circle cx="40" cy="12" r="5" />
        <circle cx="43" cy="10" {...eye} />
        <line x1="40" y1="17" x2="40" y2="30" />
        <line x1="40" y1="30" x2="35" y2="40" />
        <line x1="40" y1="30" x2="45" y2="40" />
        <path d="M40 20 q11 -3 20 1" />
        <path d="M40 22 q11 2 20 6" />
        <rect x="60" y="20" width="6" height="11" rx="1.5" />
      </svg>
    );
  }
  // 2) Dance & weave: two players sizing each other up — one near (larger), one
  // further back (smaller), eyes on each other.
  if (n === 2) {
    return (
      <svg {...base} className={ink}>
        {/* background player — smaller, set back, facing right */}
        <circle cx="20" cy="15" r="3.5" />
        <circle cx="22.2" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
        <line x1="20" y1="18.5" x2="20" y2="27" />
        <line x1="20" y1="27" x2="16" y2="34" />
        <line x1="20" y1="27" x2="24" y2="34" />
        <line x1="20" y1="21" x2="26" y2="22" />
        <line x1="20" y1="21" x2="14" y2="23" />
        {/* foreground player — larger, facing left */}
        <circle cx="66" cy="12" r="5.5" />
        <circle cx="62.3" cy="11" {...eye} />
        <line x1="66" y1="17.5" x2="66" y2="32" />
        <line x1="66" y1="32" x2="60" y2="42" />
        <line x1="66" y1="32" x2="72" y2="42" />
        <line x1="66" y1="21" x2="57" y2="24" />
        <line x1="66" y1="21" x2="75" y2="23" />
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
        {/* a rival's arm reaching in to tap the forearm */}
        <path d="M94 41 q-12 -2 -24 -9" />
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
      <circle cx="48" cy="11" r="5" />
      <circle cx="50" cy="10" {...eye} />
      <line x1="48" y1="16" x2="48" y2="30" />
      <line x1="48" y1="30" x2="43" y2="40" />
      <line x1="48" y1="30" x2="53" y2="40" />
      <line x1="48" y1="19" x2="40" y2="8" />
      <line x1="48" y1="19" x2="56" y2="8" />
      <path d="M37 6 l-2 -3" />
      <path d="M59 6 l2 -3" />
    </svg>
  );
}
