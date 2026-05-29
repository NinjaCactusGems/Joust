import { Server, routePartykitRequest, type Connection } from 'partyserver';

type Phase = 'lobby' | 'ready' | 'jousting' | 'winner';

type Reaction = 'turd' | 'heart' | 'dancer' | 'dancerF';

type Player = {
  id: string;
  name: string;
  ready: boolean;
  eliminated: boolean;
  away: boolean;
};

type RoomState = {
  type: 'state';
  phase: Phase;
  readyEndsAt: number | null;
  winnerEndsAt: number | null;
  winnerId: string | null;
  players: Player[];
};

// A fire-and-forget reaction burst, re-broadcast to everyone so each client
// can spawn the same emoji particles. Not part of RoomState — it carries no
// persistent state and isn't replayed to late joiners.
type ReactionEvent = {
  type: 'reaction';
  reaction: Reaction;
};

// Messages the client may send us.
type ClientMessage =
  | { type: 'setName'; name: string }
  | { type: 'toggleReady'; ready: boolean }
  | { type: 'visibility'; visible: boolean }
  | { type: 'start' }
  | { type: 'eliminate' }
  | { type: 'reaction'; reaction: Reaction };

const MAX_PLAYERS_PER_ROOM = 16;
const MAX_NAME_LENGTH = 24;
const READY_DURATION_MS = 5000;
const WINNER_DURATION_MS = 10000;
const REACTIONS: readonly Reaction[] = ['turd', 'heart', 'dancer', 'dancerF'];

// Reject WS upgrades whose Origin isn't ours, so other sites can't drive
// our Durable Objects from their users' browsers (cost-shifting). The
// check runs in the worker's fetch handler before routePartykitRequest,
// so unauthorized requests never spawn a DO.
const ALLOWED_ORIGINS = new Set([
  'https://joust.ninja-cactus.com',
  'https://joust.pages.dev',
]);

const ALLOWED_ORIGIN_SUFFIXES = ['.joust.pages.dev'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return ALLOWED_ORIGIN_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export class Main extends Server {
  // Hibernation is intentionally off: the room keeps mutable state (player
  // names, ready/eliminated flags, game phase) and a phase timer in memory. An
  // open WebSocket keeps a non-hibernating DO resident, so the setTimeout below
  // reliably fires. Rooms are short-lived and active, so the cost is small.
  static options = { hibernate: false };

  private phase: Phase = 'lobby';
  private readyEndsAt: number | null = null;
  private winnerEndsAt: number | null = null;
  private winnerId: string | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-connection state, keyed by connection id.
  private playerState = new Map<
    string,
    { name: string; ready: boolean; eliminated: boolean; visible: boolean }
  >();

  onConnect(connection: Connection) {
    // getConnections() already includes the new one at this point;
    // close it back out if the room is over capacity. Limits per-room
    // blast radius once a DO is alive.
    if ([...this.getConnections()].length > MAX_PLAYERS_PER_ROOM) {
      connection.close(1013, 'Room full');
      return;
    }
    // Someone joining mid-game spectates the current round (eliminated) so they
    // can't skew the win check; resetToLobby() clears this for the next round.
    const entry = this.ensurePlayer(connection.id);
    if (this.phase !== 'lobby') entry.eliminated = true;
    this.broadcastState();
  }

  onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'setName': {
        const name = String(msg.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
        if (!name) return;
        const entry = this.ensurePlayer(connection.id);
        entry.name = name;
        this.broadcastState();
        break;
      }
      case 'toggleReady': {
        if (this.phase !== 'lobby') return;
        const entry = this.ensurePlayer(connection.id);
        entry.ready = Boolean(msg.ready);
        this.broadcastState();
        break;
      }
      case 'visibility': {
        const entry = this.ensurePlayer(connection.id);
        const wasVisible = entry.visible;
        entry.visible = Boolean(msg.visible);
        if (!entry.visible) {
          // Backgrounded players can't drive the lobby — clear ready so a
          // forgotten tab can't keep the room "ready" by accident.
          entry.ready = false;
          // Mid-round, auto-eliminate so the away player doesn't haunt the
          // jousting phase forever. resetToLobby() clears this for next round.
          if (this.phase === 'ready' || this.phase === 'jousting') {
            entry.eliminated = true;
          }
        }
        this.broadcastState();
        // A forced elimination can drop the room to one survivor.
        if (!entry.visible && wasVisible && this.phase === 'jousting') {
          this.checkWinCondition();
        }
        break;
      }
      case 'start': {
        this.tryStartGame();
        break;
      }
      case 'eliminate': {
        if (this.phase !== 'jousting') return;
        const entry = this.ensurePlayer(connection.id);
        if (entry.eliminated) return; // idempotent — clients may send twice
        entry.eliminated = true;
        this.broadcastState();
        this.checkWinCondition();
        break;
      }
      case 'reaction': {
        // Allowed on the winner screen and afterwards in the lobby, so the
        // post-game celebration can keep emoting as the lobby slides in.
        if (this.phase !== 'winner' && this.phase !== 'lobby') return;
        if (!REACTIONS.includes(msg.reaction)) return;
        // Fire-and-forget: re-broadcast so every client bursts the same emoji.
        const event: ReactionEvent = { type: 'reaction', reaction: msg.reaction };
        this.broadcast(JSON.stringify(event));
        break;
      }
    }
  }

  onClose(connection: Connection) {
    this.playerState.delete(connection.id);
    this.broadcastState();
    // A disconnect can leave a single survivor — resolve the round.
    if (this.phase === 'jousting') this.checkWinCondition();
  }

  private ensurePlayer(id: string): {
    name: string;
    ready: boolean;
    eliminated: boolean;
    visible: boolean;
  } {
    let entry = this.playerState.get(id);
    if (!entry) {
      entry = { name: 'Player', ready: false, eliminated: false, visible: true };
      this.playerState.set(id, entry);
    }
    return entry;
  }

  private currentPlayers(): Player[] {
    return [...this.getConnections()].map((c: Connection) => {
      const entry = this.ensurePlayer(c.id);
      return {
        id: c.id,
        name: entry.name,
        ready: entry.ready,
        eliminated: entry.eliminated,
        away: !entry.visible,
      };
    });
  }

  // Clears any pending phase timer before scheduling the next, so transitions
  // never leave two timers racing.
  private scheduleTimer(ms: number, fn: () => void) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(fn, ms);
  }

  private tryStartGame() {
    if (this.phase !== 'lobby') return;
    // Skip away players entirely — they neither block start nor count
    // toward the "all ready" check. They stay in the room and rejoin
    // the next lobby cycle when they come back.
    const active = this.currentPlayers().filter((p) => !p.away);
    if (active.length === 0 || !active.every((p) => p.ready)) return;

    for (const entry of this.playerState.values()) {
      // Away players start the round already eliminated — they don't get
      // to spectate-then-win by tapping back in halfway through.
      entry.eliminated = !entry.visible;
    }
    this.winnerId = null;
    this.phase = 'ready';
    this.readyEndsAt = Date.now() + READY_DURATION_MS;
    this.broadcastState();

    this.scheduleTimer(READY_DURATION_MS, () => this.startJousting());
  }

  private startJousting() {
    this.phase = 'jousting';
    this.readyEndsAt = null;
    this.broadcastState();
    // A solo room (or one already down to a single player) resolves at once
    // rather than hanging in jousting forever.
    this.checkWinCondition();
  }

  private checkWinCondition() {
    if (this.phase !== 'jousting') return;
    const alive = this.currentPlayers().filter((p) => !p.eliminated);
    if (alive.length > 1) return;

    this.phase = 'winner';
    this.winnerId = alive[0]?.id ?? null;
    this.readyEndsAt = null;
    this.winnerEndsAt = Date.now() + WINNER_DURATION_MS;
    this.broadcastState();

    this.scheduleTimer(WINNER_DURATION_MS, () => this.resetToLobby());
  }

  private resetToLobby() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.phase = 'lobby';
    this.readyEndsAt = null;
    this.winnerEndsAt = null;
    this.winnerId = null;
    // Everyone returns to the lobby un-readied and back in the game.
    for (const entry of this.playerState.values()) {
      entry.ready = false;
      entry.eliminated = false;
    }
    this.broadcastState();
  }

  private broadcastState() {
    const message: RoomState = {
      type: 'state',
      phase: this.phase,
      readyEndsAt: this.readyEndsAt,
      winnerEndsAt: this.winnerEndsAt,
      winnerId: this.winnerId,
      players: this.currentPlayers(),
    };
    this.broadcast(JSON.stringify(message));
  }
}

type Env = { Main: DurableObjectNamespace };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAllowedOrigin(request.headers.get('Origin'))) {
      return new Response('Forbidden', { status: 403 });
    }
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, DurableObjectNamespace>)) ||
      new Response('Not found', { status: 404 })
    );
  },
};
