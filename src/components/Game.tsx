import { useEffect, useRef, useState } from 'react';
import { MusicNotes } from './MusicNotes';
import { haptics } from '../lib/haptics';
import type { useShakeDetector } from '../hooks/useShakeDetector';

export type Phase = 'lobby' | 'ready' | 'jousting' | 'winner';
export type Reaction = 'turd' | 'heart' | 'dancer';
export type Player = {
  id: string;
  name: string;
  ready: boolean;
  eliminated: boolean;
};

const REACTION_EMOJI: Record<Reaction, string> = {
  turd: '💩',
  heart: '❤️',
  dancer: '🕺',
};

type GameProps = {
  phase: Exclude<Phase, 'lobby'>;
  players: Player[];
  myId: string;
  readyEndsAt: number | null;
  winnerEndsAt: number | null;
  winnerId: string | null;
  detector: ReturnType<typeof useShakeDetector>;
  lastReaction: { reaction: Reaction; at: number } | null;
  onEliminate: () => void;
  onReaction: (reaction: Reaction) => void;
};

export function Game(props: GameProps) {
  const { phase } = props;
  if (phase === 'ready') return <ReadyView readyEndsAt={props.readyEndsAt} />;
  if (phase === 'jousting') return <JoustingView {...props} />;
  return <WinnerView {...props} />;
}

// Get Ready: a synced countdown on the neutral staff background. A small tick
// each second, a larger buzz on "Go". The server flips everyone to jousting
// when the timer ends.
function ReadyView({ readyEndsAt }: { readyEndsAt: number | null }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    readyEndsAt ? Math.max(0, Math.ceil((readyEndsAt - Date.now()) / 1000)) : 0,
  );

  // Tracks the last second we buzzed for, so each boundary fires its haptic
  // exactly once (the 200ms interval visits each second multiple times).
  const lastTickRef = useRef<number | null>(null);
  const wentRef = useRef(false);

  useEffect(() => {
    if (readyEndsAt === null) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((readyEndsAt - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s > 0) {
        if (lastTickRef.current !== s) {
          lastTickRef.current = s;
          haptics.tick();
        }
      } else if (!wentRef.current) {
        wentRef.current = true;
        haptics.go();
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [readyEndsAt]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-staff text-ink">
      <div className="text-sm font-semibold uppercase tracking-[0.3em] text-ink-muted">
        Get Ready
      </div>
      {secondsLeft > 0 ? (
        <div className="font-serif text-9xl font-bold tabular-nums">
          {secondsLeft}
        </div>
      ) : (
        <div className="font-serif text-8xl font-bold tracking-tight text-go">
          GO!
        </div>
      )}
      <div className="text-sm text-ink-muted">Hold still…</div>
    </div>
  );
}

// Jousting: hold still. A motion spike above the Normal threshold (wired in
// Room as useShakeDetector(7)) reports elimination to the server. Full-screen
// olive while you're in, red the moment you're out — readable across a room.
function JoustingView({
  players,
  myId,
  detector,
  onEliminate,
}: GameProps) {
  const me = players.find((p) => p.id === myId);
  const iAmOut = me?.eliminated ?? false;

  // lastShakeAt persists across phases, so ignore any spike from before
  // jousting began. Set the gate once when this view first mounts.
  const startedAtRef = useRef<number>(Date.now());
  // Fire elimination at most once per round (the view remounts each round).
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || iAmOut) return;
    if (detector.lastShakeAt === null) return;
    if (detector.lastShakeAt <= startedAtRef.current) return;
    firedRef.current = true;
    haptics.elimination();
    onEliminate();
  }, [detector.lastShakeAt, iAmOut, onEliminate]);

  const aliveCount = players.filter((p) => !p.eliminated).length;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center text-paper transition-colors duration-300 ${
        iAmOut ? 'bg-eliminated' : 'bg-olive'
      }`}
    >
      <MusicNotes />
      {iAmOut ? (
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="font-serif text-8xl font-bold tracking-tight">OUT</div>
          <div className="text-sm uppercase tracking-[0.3em] text-paper/80">
            {aliveCount} still in
          </div>
        </div>
      ) : (
        <div className="relative z-10 text-sm font-semibold uppercase tracking-[0.4em] text-paper/70">
          Hold still
        </div>
      )}
    </div>
  );
}

// Winner: the survivor's name, with smiley reaction buttons open to everyone.
// Each tap (local or remote) bursts emoji particles on every screen. The server
// returns everyone to the lobby after the winner timer ends.
function WinnerView({
  players,
  myId,
  winnerId,
  winnerEndsAt,
  lastReaction,
  onReaction,
}: GameProps) {
  const winner = players.find((p) => p.id === winnerId);
  const iWon = winnerId !== null && winnerId === myId;

  const [secondsLeft, setSecondsLeft] = useState(() =>
    winnerEndsAt ? Math.max(0, Math.ceil((winnerEndsAt - Date.now()) / 1000)) : 0,
  );
  useEffect(() => {
    if (winnerEndsAt === null) return;
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((winnerEndsAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [winnerEndsAt]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-staff text-ink">
      <ReactionParticles lastReaction={lastReaction} />

      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] text-ochre">
          {iWon ? 'You win!' : 'Winner'}
        </div>
        <div className="font-serif text-6xl font-bold tracking-tight text-center px-6">
          {winner?.name ?? 'No one'}
        </div>
      </div>

      <div className="relative z-10 flex gap-4">
        {(Object.keys(REACTION_EMOJI) as Reaction[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onReaction(r)}
            className="grid h-16 w-16 place-items-center rounded-2xl border border-line bg-paper-raised text-4xl shadow-sm active:scale-90 transition"
            aria-label={r}
          >
            {REACTION_EMOJI[r]}
          </button>
        ))}
      </div>

      {secondsLeft > 0 && (
        <div className="relative z-10 text-sm text-ink-muted">
          Back to lobby in {secondsLeft}…
        </div>
      )}
    </div>
  );
}

type Particle = { id: number; emoji: string; left: number; delay: number };

// Spawns a short burst of floating emoji each time a reaction event arrives.
// Particles self-remove once their animation completes.
function ReactionParticles({
  lastReaction,
}: {
  lastReaction: { reaction: Reaction; at: number } | null;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const seqRef = useRef(0);

  // Re-run per distinct reaction event, keyed by its timestamp.
  const at = lastReaction?.at;
  const reaction = lastReaction?.reaction;
  useEffect(() => {
    if (!reaction) return;
    const emoji = REACTION_EMOJI[reaction];
    const batch: Particle[] = Array.from({ length: 10 }, () => ({
      id: seqRef.current++,
      emoji,
      left: 5 + Math.random() * 90, // vw
      delay: Math.random() * 0.3, // s
    }));
    setParticles((prev) => [...prev, ...batch]);

    const ids = new Set(batch.map((p) => p.id));
    const timer = window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !ids.has(p.id)));
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [at, reaction]);

  if (particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="animate-reaction-float absolute bottom-0 text-5xl"
          style={{ left: `${p.left}vw`, animationDelay: `${p.delay}s` }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
