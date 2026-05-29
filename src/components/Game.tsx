import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MusicNotes } from './MusicNotes';
import { useI18n } from '../i18n/I18nContext';
import { haptics } from '../lib/haptics';
import { sfx } from '../lib/sfx';
import { teamById, type TeamId } from '../lib/teams';
import type { useShakeDetector } from '../hooks/useShakeDetector';

export type Phase = 'lobby' | 'ready' | 'jousting' | 'winner';
export type Reaction = 'turd' | 'heart' | 'dancer' | 'dancerF';
export type Player = {
  id: string;
  name: string;
  ready: boolean;
  eliminated: boolean;
  away: boolean;
  team: TeamId | null;
};

const REACTION_EMOJI: Record<Reaction, string> = {
  turd: '💩',
  heart: '❤️',
  dancer: '🕺',
  dancerF: '💃',
};

type GameProps = {
  phase: Exclude<Phase, 'lobby'>;
  players: Player[];
  myId: string;
  readyEndsAt: number | null;
  winnerEndsAt: number | null;
  winnerId: string | null;
  winnerTeam: TeamId | null;
  detector: ReturnType<typeof useShakeDetector>;
  lastReaction: { reaction: Reaction; at: number } | null;
  onEliminate: () => void;
  onReaction: (reaction: Reaction) => void;
  // Post-game: the winner stays on screen and the lobby slides up from below
  // (rendered here) so players can keep emoting. Server phase is 'lobby', but
  // Room renders Game with phase 'winner' + these props.
  postGame?: boolean;
  lobbySheet?: ReactNode;
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
  const { t } = useI18n();
  const [secondsLeft, setSecondsLeft] = useState(() =>
    readyEndsAt ? Math.max(0, Math.ceil((readyEndsAt - Date.now()) / 1000)) : 0,
  );

  // Tracks the last second we buzzed for, so each boundary fires its haptic
  // exactly once (the 200ms interval visits each second multiple times). The
  // "Go" buzz is fired by JoustingView on mount instead — the countdown
  // reaching 0 here races the server's jousting message and is unreliable.
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (readyEndsAt === null) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((readyEndsAt - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s > 0 && lastTickRef.current !== s) {
        lastTickRef.current = s;
        haptics.tick();
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [readyEndsAt]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-staff text-ink">
      <div className="text-sm font-semibold uppercase tracking-[0.3em] text-ink-muted">
        {t('game.getReady')}
      </div>
      {secondsLeft > 0 ? (
        <div className="font-serif text-9xl font-bold tabular-nums">
          {secondsLeft}
        </div>
      ) : (
        <div className="font-serif text-8xl font-bold tracking-tight text-go">
          {t('game.go')}
        </div>
      )}
      <div className="text-sm text-ink-muted">{t('game.holdStillEllipsis')}</div>
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
  const { t } = useI18n();
  const me = players.find((p) => p.id === myId);
  const iAmOut = me?.eliminated ?? false;

  // lastShakeAt persists across phases, so ignore any spike from before
  // jousting began. Set the gate once when this view first mounts.
  const startedAtRef = useRef<number>(Date.now());
  // Fire elimination at most once per round (the view remounts each round).
  const firedRef = useRef(false);

  // "Go" buzz: fired here (rather than at the countdown's racy 0) so it
  // reliably lands exactly when jousting begins.
  useEffect(() => {
    haptics.go();
  }, []);

  useEffect(() => {
    if (firedRef.current || iAmOut) return;
    if (detector.lastShakeAt === null) return;
    if (detector.lastShakeAt <= startedAtRef.current) return;
    firedRef.current = true;
    haptics.elimination();
    sfx.screech();
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
          <div className="font-serif text-8xl font-bold tracking-tight">
            {t('game.out')}
          </div>
          <div className="text-sm uppercase tracking-[0.3em] text-paper/80">
            {t('game.stillIn', { count: aliveCount })}
          </div>
        </div>
      ) : (
        <div className="relative z-10 text-sm font-semibold uppercase tracking-[0.4em] text-paper/70">
          {t('game.holdStill')}
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
  winnerTeam,
  winnerEndsAt,
  lastReaction,
  onReaction,
  postGame,
  lobbySheet,
}: GameProps) {
  const { t } = useI18n();
  const me = players.find((p) => p.id === myId);
  const winner = players.find((p) => p.id === winnerId);
  const winningTeam = teamById(winnerTeam);
  // A team victory counts for everyone on it; otherwise only the lone survivor.
  const iWon = winnerTeam
    ? me?.team === winnerTeam
    : winnerId !== null && winnerId === myId;

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

  const header = (
    <div className="relative z-30 flex flex-col items-center gap-2">
      <div className="text-sm font-semibold uppercase tracking-[0.3em] text-ochre">
        {t(iWon ? 'game.youWin' : 'game.winner')}
      </div>
      {winningTeam ? (
        <div
          className="font-serif text-5xl font-bold tracking-tight text-center px-6"
          style={{ color: winningTeam.color }}
        >
          {t('game.teamWins', { team: winningTeam.label })}
        </div>
      ) : (
        <div className="font-serif text-5xl font-bold tracking-tight text-center px-6">
          {winner?.name ?? t('game.noOne')}
        </div>
      )}
    </div>
  );

  // Reaction bar stays available so the celebration can keep emoting, both on
  // the winner screen and once the lobby has slid in beneath it.
  const smileys = (
    <div className="relative z-30 flex gap-3">
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
  );

  if (postGame) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-staff text-ink">
        <ReactionParticles lastReaction={lastReaction} />
        <div className="flex shrink-0 flex-col items-center gap-4 px-6 pt-10 pb-4">
          {/* Once the lobby has slid up, the winner banner fades away so the
              room can focus on getting the next match going (smileys stay). */}
          <div className="animate-winner-fade">{header}</div>
          {smileys}
        </div>
        <div className="relative z-10 flex min-h-0 flex-1 items-end justify-center px-4 pb-4">
          <div className="animate-sheet-up max-h-full w-full max-w-sm overflow-y-auto">
            {lobbySheet}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-staff text-ink">
      <ReactionParticles lastReaction={lastReaction} />
      {header}
      {smileys}
      {secondsLeft > 0 && (
        <div className="relative z-30 text-sm text-ink-muted">
          {t('game.backToLobby', { seconds: secondsLeft })}
        </div>
      )}
    </div>
  );
}

type Particle = { id: number; emoji: string; left: number };

// Floats a single emoji up the screen for each reaction event (one per tap).
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
    sfx.reaction(reaction);
    const particle: Particle = {
      id: seqRef.current++,
      emoji: REACTION_EMOJI[reaction],
      left: 5 + Math.random() * 90, // vw
    };
    setParticles((prev) => [...prev, particle]);

    const timer = window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== particle.id));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [at, reaction]);

  if (particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="animate-reaction-float absolute bottom-0 text-5xl"
          style={{ left: `${p.left}vw` }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
