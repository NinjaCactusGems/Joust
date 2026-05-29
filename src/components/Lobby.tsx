import { useEffect, useMemo, useRef, useState } from 'react';
import usePartySocket from 'partysocket/react';
import { QRCodeSVG } from 'qrcode.react';
import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';
import { generateRandomName } from '../lib/names';
import { Game, type Phase, type Reaction } from './Game';
import { TEAMS, teamById, type TeamId } from '../lib/teams';
import { useShakeDetector } from '../hooks/useShakeDetector';
import { useMatchMusic } from '../hooks/useMatchMusic';
import { useServerClock } from '../hooks/useServerClock';
import { useSyncedTempo } from '../hooks/useSyncedTempo';
import { useWakeLock } from '../hooks/useWakeLock';
import { TEMPO_THRESHOLD, type Tempo } from '../lib/tempo';
import { sfx } from '../lib/sfx';
import { useI18n } from '../i18n/I18nContext';

const PARTY_HOST = import.meta.env.VITE_PARTY_HOST || 'localhost:1999';

const PLAYER_NAME_KEY = 'joust:playerName';

// Jousting starts at the Normal/medium threshold (7 m/s², per CLAUDE.md); tempo
// shifts move it to Sensitive (slow) or Forgiving (fast) mid-round.
const JOUST_THRESHOLD = TEMPO_THRESHOLD.normal;

// After a win the server returns to the lobby, but we keep the celebration
// (soundtrack + applause) going this much longer so it rides through the
// transition and ends as the post-game lobby panel fades in, rather than
// cutting the moment it appears.
const POSTGAME_HOLD_MS = 1000;

// Teams unlock at 3+ players (below that it's a free-for-all). Kept in sync with
// the server's MIN_PLAYERS_FOR_TEAMS.
const MIN_PLAYERS_FOR_TEAMS = 3;

type Player = {
  id: string;
  name: string;
  ready: boolean;
  eliminated: boolean;
  away: boolean;
  team: TeamId | null;
};

type LobbyState =
  | { phase: 'idle' }
  | { phase: 'in-room'; code: string };

function readRoomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const code = new URLSearchParams(window.location.search).get('room');
  if (!code) return null;
  const normalized = normalizeRoomCode(code);
  return normalized.length >= 3 ? normalized : null;
}

function getPlayerName(): string {
  if (typeof window === 'undefined') return 'Player';
  let name = window.localStorage.getItem(PLAYER_NAME_KEY);
  if (!name) {
    name = generateRandomName();
    window.localStorage.setItem(PLAYER_NAME_KEY, name);
  }
  return name;
}

export function Lobby() {
  const initial = useMemo<LobbyState>(() => {
    const code = readRoomFromUrl();
    return code ? { phase: 'in-room', code } : { phase: 'idle' };
  }, []);
  const [state, setState] = useState<LobbyState>(initial);

  const leave = () => {
    setState({ phase: 'idle' });
    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState(null, '', url.toString());
    }
  };

  if (state.phase === 'in-room') {
    return <Room code={state.code} onLeave={leave} />;
  }

  return <IdleLobby onEnter={(code) => setState({ phase: 'in-room', code })} />;
}

function IdleLobby({ onEnter }: { onEnter: (code: string) => void }) {
  const { t } = useI18n();
  const [joinCode, setJoinCode] = useState('');
  const normalized = normalizeRoomCode(joinCode);
  const canJoin = normalized.length >= 3;

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised/80 p-5 flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onEnter(generateRoomCode())}
        className="w-full rounded-full bg-go px-6 py-3 text-base font-semibold text-paper shadow-lg shadow-go/20 active:scale-95 transition"
      >
        {t('lobby.create')}
      </button>

      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <div className="h-px flex-1 bg-line" />
        <span>{t('lobby.or')}</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canJoin) onEnter(normalized);
        }}
      >
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('lobby.codePlaceholder')}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          maxLength={8}
          className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-center text-lg font-mono tracking-[0.3em] uppercase text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink-muted"
        />
        <button
          type="submit"
          disabled={!canJoin}
          className="w-full rounded-full bg-ink px-6 py-3 text-base font-semibold text-paper active:scale-95 transition disabled:bg-line disabled:text-ink-faint"
        >
          {t('lobby.join')}
        </button>
      </form>
    </div>
  );
}

function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  // Per-mount connection id: each tab/Room mount gets its own. Sharing one id
  // across browser tabs (e.g. via localStorage) collides at the partyserver
  // layer — the second WS with the same id evicts the first, so only one
  // tab can stay connected at a time.
  const { t } = useI18n();
  const myId = useMemo(() => crypto.randomUUID(), []);
  const myName = useRef(getPlayerName());

  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [readyEndsAt, setReadyEndsAt] = useState<number | null>(null);
  const [winnerEndsAt, setWinnerEndsAt] = useState<number | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [winnerTeam, setWinnerTeam] = useState<TeamId | null>(null);
  const [tempo, setTempo] = useState<Tempo>('normal');
  const [tempoEffectiveAt, setTempoEffectiveAt] = useState<number | null>(null);
  // The winner we keep showing once the server returns to the lobby, so the
  // lobby can slide in beneath the celebration. Cleared when a new round starts.
  const [postGameWinnerId, setPostGameWinnerId] = useState<string | null>(null);
  const [postGameWinnerTeam, setPostGameWinnerTeam] = useState<TeamId | null>(
    null,
  );
  const [lastReaction, setLastReaction] = useState<{
    reaction: Reaction;
    at: number;
  } | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  // One motion session for the whole room, started on the "I'm ready" gesture
  // (iOS requires the permission request to come from a user gesture). The
  // Game overlay reads lastShakeAt from this to detect "moved too fast".
  const detector = useShakeDetector(JOUST_THRESHOLD);

  // Keep the screen awake for the whole time in a room: a phone slipping into
  // standby hides the page, which the server treats as "away".
  useWakeLock(true);

  const socket = usePartySocket({
    host: PARTY_HOST,
    party: 'main',
    room: code,
    id: myId,
    onOpen() {
      setStatus('open');
    },
    onClose() {
      setStatus('closed');
    },
    onMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data) as Partial<{
          type: string;
          phase: Phase;
          readyEndsAt: number | null;
          winnerEndsAt: number | null;
          winnerId: string | null;
          winnerTeam: TeamId | null;
          tempo: Tempo;
          tempoEffectiveAt: number | null;
          players: Player[];
          reaction: Reaction;
        }>;
        if (data.type === 'state') {
          const nextPhase = data.phase ?? 'lobby';
          setPhase(nextPhase);
          setReadyEndsAt(data.readyEndsAt ?? null);
          setWinnerEndsAt(data.winnerEndsAt ?? null);
          setWinnerId(data.winnerId ?? null);
          setWinnerTeam(data.winnerTeam ?? null);
          setTempo(data.tempo ?? 'normal');
          setTempoEffectiveAt(data.tempoEffectiveAt ?? null);
          setPlayers(Array.isArray(data.players) ? data.players : []);
          // Remember the winner so the post-game lobby can keep showing it; a
          // new round (ready/jousting) clears it.
          if (nextPhase === 'ready' || nextPhase === 'jousting') {
            setPostGameWinnerId(null);
            setPostGameWinnerTeam(null);
          } else if (
            nextPhase === 'winner' &&
            (data.winnerId || data.winnerTeam)
          ) {
            setPostGameWinnerId(data.winnerId ?? null);
            setPostGameWinnerTeam(data.winnerTeam ?? null);
          }
        } else if (data.type === 'reaction' && data.reaction) {
          setLastReaction({ reaction: data.reaction, at: Date.now() });
        }
      } catch {
        // ignore non-JSON frames
      }
    },
  });

  // Announce our name once connected.
  useEffect(() => {
    if (status === 'open') {
      socket.send(JSON.stringify({ type: 'setName', name: myName.current }));
    }
  }, [status, socket]);

  // Broadcast tab visibility so the server can ignore backgrounded players
  // for the "all ready" gate — otherwise a forgotten tab in the room holds
  // everyone else hostage waiting for it to ready up.
  useEffect(() => {
    if (status !== 'open') return;
    const send = (visible: boolean) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'visibility', visible }));
      }
    };
    send(!document.hidden);
    const onChange = () => send(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [status, socket]);

  // Server clock sync: converts server timestamps to local time so every device
  // in the room acts in lockstep (and a foundation for future server-driven
  // sync like changing the track tempo for everyone at once).
  const { toLocalTime } = useServerClock(socket, status === 'open');

  const me = players.find((p) => p.id === myId);

  // Whether the match soundtrack should be running. Live through any non-lobby
  // phase; once the server returns to the lobby it keeps going for a short beat
  // if we're celebrating a win (post-game), so the music carries the transition
  // and fades out as the lobby panel fades in — then stops, so it never plays
  // before the next match starts.
  const [musicActive, setMusicActive] = useState(false);
  useEffect(() => {
    if (phase !== 'lobby') {
      setMusicActive(true);
      return;
    }
    if (!postGameWinnerId && !postGameWinnerTeam) {
      setMusicActive(false);
      return;
    }
    const id = window.setTimeout(() => setMusicActive(false), POSTGAME_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase, postGameWinnerId, postGameWinnerTeam]);

  // Whether to keep applauding. Active for the whole winner phase, then held a
  // beat into the post-game so the claps endure until the lobby panel has faded
  // in — mirroring the music. (Distinct from musicActive, which also covers
  // ready/jousting, where we don't clap.)
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (phase === 'winner') {
      setCelebrating(true);
      return;
    }
    if (phase === 'lobby' && (postGameWinnerId || postGameWinnerTeam)) {
      const id = window.setTimeout(() => setCelebrating(false), POSTGAME_HOLD_MS);
      return () => window.clearTimeout(id);
    }
    setCelebrating(false);
  }, [phase, postGameWinnerId, postGameWinnerTeam]);

  // Looping match soundtrack: starts when the "Get Ready" countdown hits zero
  // (readyEndsAt) — in lockstep across devices via the server clock — shifts
  // tempo with the room, and goes silent for this player while eliminated.
  useMatchMusic(
    readyEndsAt,
    Boolean(me?.eliminated),
    toLocalTime,
    tempo,
    tempoEffectiveAt,
    musicActive,
  );

  // Match the shake sensitivity to the tempo, in lockstep with the music:
  // slow → Sensitive (twitchy), fast → Forgiving (needs a real shove).
  useSyncedTempo(tempo, tempoEffectiveAt, toLocalTime, (next) =>
    detector.setThreshold(TEMPO_THRESHOLD[next]),
  );

  // When a winner is crowned, the losers' phones applaud — each phone loops the
  // applause clip at a slightly randomized pitch/speed, so a roomful of phones
  // blends into a sustained crowd. It runs the whole winner phase and a beat into
  // the post-game (via `celebrating`), ending as the lobby panel fades in. The
  // winner's own phone stays quiet. The live winner fields go null once the
  // server resets to the lobby, so fall back to the post-game copies to keep the
  // applause going through the transition.
  const myTeam = me?.team ?? null;
  const effWinnerId = winnerId ?? postGameWinnerId;
  const effWinnerTeam = winnerTeam ?? postGameWinnerTeam;
  useEffect(() => {
    if (!celebrating) return;
    if (effWinnerId === null && effWinnerTeam === null) return;
    const iWon = effWinnerTeam
      ? myTeam === effWinnerTeam
      : effWinnerId === myId;
    if (iWon) return;
    return sfx.applause();
  }, [celebrating, effWinnerId, effWinnerTeam, myId, myTeam]);

  const send = (msg: unknown) => {
    if (status === 'open') socket.send(JSON.stringify(msg));
  };

  // Backgrounded tabs are skipped — they neither block start nor count.
  const activePlayers = players.filter((p) => !p.away);
  const allReady = activePlayers.length > 0 && activePlayers.every((p) => p.ready);

  // Teams unlock at 3+ active players. Below that, everyone is their own side.
  const teamsActive = activePlayers.length >= MIN_PLAYERS_FOR_TEAMS;
  // Mirror the server gate: need ≥2 distinct sides to start (a lone player is
  // exempt — Johann fills in). Blocks the "everyone on one team" start.
  const factions = new Set(
    activePlayers.map((p) =>
      teamsActive && p.team ? `team:${p.team}` : `solo:${p.id}`,
    ),
  );
  const canStartTeams = activePlayers.length <= 1 || factions.size >= 2;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${code}`
      : `/?room=${code}`;

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const startEditing = () => {
    setDraftName(me?.name ?? myName.current);
    setEditing(true);
  };

  const saveName = () => {
    const name = draftName.trim().slice(0, 24);
    if (name) {
      myName.current = name;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PLAYER_NAME_KEY, name);
      }
      send({ type: 'setName', name });
    }
    setEditing(false);
  };

  // Enabling motion needs a user gesture (iOS); the ready checkbox is one.
  const onToggleReady = (ready: boolean) => {
    if (ready) void detector.start();
    send({ type: 'toggleReady', ready });
  };

  if (phase !== 'lobby') {
    return (
      <Game
        phase={phase}
        players={players}
        myId={myId}
        readyEndsAt={readyEndsAt}
        winnerEndsAt={winnerEndsAt}
        winnerId={winnerId}
        winnerTeam={winnerTeam}
        detector={detector}
        lastReaction={lastReaction}
        toLocalTime={toLocalTime}
        onEliminate={() => send({ type: 'eliminate' })}
        onReaction={(reaction) => send({ type: 'reaction', reaction })}
      />
    );
  }

  const lobbyPanel = (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised/80 p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          {t('room.group')}
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="text-center font-serif text-4xl tracking-[0.4em] text-ink">
        {code}
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="rounded-xl bg-paper-raised p-3">
          <QRCodeSVG value={shareUrl} size={140} bgColor="#FBF8F1" fgColor="#1F1B16" />
        </div>
        <button
          type="button"
          onClick={copy}
          className="w-full rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink active:scale-95 transition"
        >
          {t(copied ? 'room.linkCopied' : 'room.copyLink')}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-ink-muted">
          {t('room.players', { count: players.length })}
        </div>
        {players.length === 0 ? (
          <div className="text-sm text-ink-faint italic">
            {t('room.waiting')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {players.map((p) => {
              const isMe = p.id === myId;
              const team = teamById(p.team);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                    isMe
                      ? 'bg-go/10 ring-1 ring-go/40'
                      : 'bg-paper'
                  } ${p.away ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      p.away ? 'bg-ink-faint' : p.ready ? 'bg-go' : 'bg-ink-faint'
                    }`}
                    title={t(
                      p.away
                        ? 'room.away'
                        : p.ready
                          ? 'room.ready'
                          : 'room.notReady',
                    )}
                  />
                  {isMe && editing ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveName();
                      }}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={draftName}
                        maxLength={24}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={saveName}
                        className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus:outline-none focus:border-go"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-md bg-go px-2 py-1 text-xs font-semibold text-paper"
                      >
                        {t('room.save')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {p.name}
                      </span>
                      {team && (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper"
                          style={{ backgroundColor: team.color }}
                        >
                          {team.label}
                        </span>
                      )}
                      {p.away && (
                        <span className="shrink-0 rounded-full bg-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                          {t('room.away')}
                        </span>
                      )}
                      {isMe && (
                        <>
                          <span className="shrink-0 rounded-full bg-go/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-go">
                            {t('room.you')}
                          </span>
                          <button
                            type="button"
                            onClick={startEditing}
                            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted active:scale-95 transition"
                          >
                            {t('room.rename')}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {players.length >= MIN_PLAYERS_FOR_TEAMS && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-ink-muted">
            {t('room.team')}
          </span>
          <select
            value={me?.team ?? ''}
            onChange={(e) =>
              send({
                type: 'setTeam',
                team: (e.target.value || null) as TeamId | null,
              })
            }
            className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-base text-ink focus:outline-none focus:border-ink-muted"
          >
            <option value="">{t('room.teamSolo')}</option>
            {TEAMS.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={() => onToggleReady(!(me?.ready ?? false))}
        className={`w-full rounded-full px-6 py-4 text-lg font-semibold text-paper shadow-lg active:scale-95 transition ${
          me?.ready ? 'bg-go shadow-go/25' : 'bg-eliminated shadow-eliminated/25'
        }`}
      >
        {t(me?.ready ? 'room.readyDone' : 'room.readyPrompt')}
      </button>

      {(detector.permissionState === 'denied' ||
        detector.permissionState === 'unavailable') && (
        <p className="-mt-2 text-xs text-accent">{t('room.motionWarning')}</p>
      )}

      <button
        type="button"
        disabled={!allReady || !canStartTeams}
        onClick={() => send({ type: 'start' })}
        className="w-full rounded-full bg-go px-6 py-3 text-base font-semibold text-paper shadow-lg shadow-go/20 active:scale-95 transition disabled:bg-line disabled:text-ink-faint disabled:shadow-none"
      >
        {t(
          !allReady
            ? 'room.waitingEveryone'
            : !canStartTeams
              ? 'room.needTeams'
              : 'room.startMatch',
        )}
      </button>

      <button
        type="button"
        onClick={onLeave}
        className="w-full rounded-full bg-line px-6 py-3 text-sm font-semibold text-ink active:scale-95 transition"
      >
        {t('room.leave')}
      </button>
    </div>
  );

  // Just won? Keep the winner on screen and slide the lobby up beneath it so
  // players can keep tapping smileys. Otherwise show the plain lobby.
  if (postGameWinnerId || postGameWinnerTeam) {
    return (
      <Game
        phase="winner"
        players={players}
        myId={myId}
        readyEndsAt={null}
        winnerEndsAt={null}
        winnerId={postGameWinnerId}
        winnerTeam={postGameWinnerTeam}
        detector={detector}
        lastReaction={lastReaction}
        toLocalTime={toLocalTime}
        onEliminate={() => {}}
        onReaction={(reaction) => send({ type: 'reaction', reaction })}
        postGame
        lobbySheet={lobbyPanel}
      />
    );
  }

  return lobbyPanel;
}

function StatusBadge({ status }: { status: 'connecting' | 'open' | 'closed' }) {
  const { t } = useI18n();
  const styles =
    status === 'open'
      ? 'bg-go/15 text-go border-go/40'
      : status === 'connecting'
        ? 'bg-ochre/15 text-ochre border-ochre/40'
        : 'bg-accent/15 text-accent border-accent/40';
  const label = t(
    status === 'open'
      ? 'status.connected'
      : status === 'connecting'
        ? 'status.connecting'
        : 'status.offline',
  );
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'open'
            ? 'bg-go animate-pulse'
            : status === 'connecting'
              ? 'bg-ochre animate-pulse'
              : 'bg-accent'
        }`}
      />
      {label}
    </span>
  );
}
