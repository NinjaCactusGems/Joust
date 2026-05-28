import { useEffect, useMemo, useState } from 'react';
import usePartySocket from 'partysocket/react';
import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';

const PARTY_HOST = import.meta.env.VITE_PARTY_HOST || 'localhost:1999';

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
    <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        Lobby
      </h2>

      <button
        type="button"
        onClick={() => onEnter(generateRoomCode())}
        className="w-full rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
      >
        Create room
      </button>

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <div className="h-px flex-1 bg-slate-800" />
        <span>or</span>
        <div className="h-px flex-1 bg-slate-800" />
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
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-center text-lg font-mono tracking-[0.3em] uppercase text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        <button
          type="submit"
          disabled={!canJoin}
          className="w-full rounded-full bg-slate-100 px-6 py-3 text-base font-semibold text-slate-950 active:scale-95 transition disabled:bg-slate-800 disabled:text-slate-500"
        >
          Join
        </button>
      </form>
    </div>
  );
}

function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  const [players, setPlayers] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>(
    'connecting',
  );
  const [copied, setCopied] = useState(false);

  usePartySocket({
    host: PARTY_HOST,
    party: 'main',
    room: code,
    onOpen() {
      setStatus('open');
    },
    onClose() {
      setStatus('closed');
    },
    onMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data) as { type?: string; players?: string[] };
        if (data.type === 'presence' && Array.isArray(data.players)) {
          setPlayers(data.players);
        }
      } catch {
        // ignore non-JSON frames
      }
    },
  });

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

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Room
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="text-center font-mono text-4xl tracking-[0.4em] text-slate-100">
        {code}
      </div>

      <button
        type="button"
        onClick={copy}
        className="w-full rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 active:scale-95 transition"
      >
        {copied ? 'Link copied' : 'Copy share link'}
      </button>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Players · {players.length}
        </div>
        {players.length === 0 ? (
          <div className="text-sm text-slate-500 italic">
            Waiting for connection…
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {players.map((p) => (
              <li
                key={p}
                className="font-mono text-sm text-slate-300 truncate"
                title={p}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onLeave}
        className="w-full rounded-full bg-slate-800 px-6 py-3 text-sm font-semibold text-slate-200 active:scale-95 transition"
      >
        Leave
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: 'connecting' | 'open' | 'closed' }) {
  const styles =
    status === 'open'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : status === 'connecting'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  const label =
    status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'open'
            ? 'bg-emerald-400 animate-pulse'
            : status === 'connecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-rose-400'
        }`}
      />
      {label}
    </span>
  );
}
