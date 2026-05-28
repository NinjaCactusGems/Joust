import { useEffect, useMemo, useRef, useState } from 'react';
import usePartySocket from 'partysocket/react';
import { QRCodeSVG } from 'qrcode.react';
import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';
import { generateRandomName } from '../lib/names';
import { Game, type Phase, type Reaction } from './Game';
import { useShakeDetector } from '../hooks/useShakeDetector';

const PARTY_HOST = import.meta.env.VITE_PARTY_HOST || 'localhost:1999';

const PLAYER_ID_KEY = 'joust:playerId';
const PLAYER_NAME_KEY = 'joust:playerName';

// Jousting watches motion at the Normal/medium threshold (7 m/s², per CLAUDE.md).
const JOUST_THRESHOLD = 7;

type Player = { id: string; name: string; ready: boolean; eliminated: boolean };

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

// Stable identity so the server can tell connections apart and the client can
// recognise its own entity. Persisted so a reload keeps the same name.
function getPlayerId(): string {
  if (typeof window === 'undefined') return 'anon';
  let id = window.localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
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
  const [joinCode, setJoinCode] = useState('');
  const normalized = normalizeRoomCode(joinCode);
  const canJoin = normalized.length >= 3;

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised/80 p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Lobby
      </h2>

      <button
        type="button"
        onClick={() => onEnter(generateRoomCode())}
        className="w-full rounded-full bg-go px-6 py-3 text-base font-semibold text-paper shadow-lg shadow-go/20 active:scale-95 transition"
      >
        Create room
      </button>

      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <div className="h-px flex-1 bg-line" />
        <span>or</span>
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
          placeholder="ROOM CODE"
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
          Join
        </button>
      </form>
    </div>
  );
}

function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  const myId = useMemo(() => getPlayerId(), []);
  const myName = useRef(getPlayerName());

  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [readyEndsAt, setReadyEndsAt] = useState<number | null>(null);
  const [winnerEndsAt, setWinnerEndsAt] = useState<number | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
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
          players: Player[];
          reaction: Reaction;
        }>;
        if (data.type === 'state') {
          setPhase(data.phase ?? 'lobby');
          setReadyEndsAt(data.readyEndsAt ?? null);
          setWinnerEndsAt(data.winnerEndsAt ?? null);
          setWinnerId(data.winnerId ?? null);
          setPlayers(Array.isArray(data.players) ? data.players : []);
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

  const send = (msg: unknown) => {
    if (status === 'open') socket.send(JSON.stringify(msg));
  };

  const me = players.find((p) => p.id === myId);
  const allReady = players.length > 0 && players.every((p) => p.ready);

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
        detector={detector}
        lastReaction={lastReaction}
        onEliminate={() => send({ type: 'eliminate' })}
        onReaction={(reaction) => send({ type: 'reaction', reaction })}
      />
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised/80 p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Room
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
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-ink-muted">
          Players · {players.length}
        </div>
        {players.length === 0 ? (
          <div className="text-sm text-ink-faint italic">
            Waiting for connection…
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {players.map((p) => {
              const isMe = p.id === myId;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                    isMe
                      ? 'bg-go/10 ring-1 ring-go/40'
                      : 'bg-paper'
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      p.ready ? 'bg-go' : 'bg-ink-faint'
                    }`}
                    title={p.ready ? 'Ready' : 'Not ready'}
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
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-ink">
                        {p.name}
                      </span>
                      {isMe && (
                        <>
                          <span className="shrink-0 rounded-full bg-go/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-go">
                            You
                          </span>
                          <button
                            type="button"
                            onClick={startEditing}
                            className="shrink-0 text-xs text-ink-muted underline-offset-2 hover:underline"
                          >
                            Rename
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

      <label className="flex items-center gap-2.5 rounded-xl border border-line bg-paper px-4 py-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={me?.ready ?? false}
          onChange={(e) => onToggleReady(e.target.checked)}
          className="h-4 w-4 accent-go"
        />
        I'm ready
      </label>

      {(detector.permissionState === 'denied' ||
        detector.permissionState === 'unavailable') && (
        <p className="-mt-2 text-xs text-accent">
          Motion sensing is off, so you can't be eliminated. Open
          joust.ninja-cactus.com on a phone for the full game.
        </p>
      )}

      <button
        type="button"
        disabled={!allReady}
        onClick={() => send({ type: 'start' })}
        className="w-full rounded-full bg-go px-6 py-3 text-base font-semibold text-paper shadow-lg shadow-go/20 active:scale-95 transition disabled:bg-line disabled:text-ink-faint disabled:shadow-none"
      >
        {allReady ? 'Start match' : 'Waiting for everyone…'}
      </button>

      <button
        type="button"
        onClick={onLeave}
        className="w-full rounded-full bg-line px-6 py-3 text-sm font-semibold text-ink active:scale-95 transition"
      >
        Leave
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: 'connecting' | 'open' | 'closed' }) {
  const styles =
    status === 'open'
      ? 'bg-go/15 text-go border-go/40'
      : status === 'connecting'
        ? 'bg-ochre/15 text-ochre border-ochre/40'
        : 'bg-accent/15 text-accent border-accent/40';
  const label =
    status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Offline';
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
