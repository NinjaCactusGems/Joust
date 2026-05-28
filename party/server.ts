import { Server, routePartykitRequest, type Connection } from 'partyserver';

type Phase = 'lobby' | 'match';

type Player = { id: string; name: string; ready: boolean };

type RoomState = {
  type: 'state';
  phase: Phase;
  matchEndsAt: number | null;
  players: Player[];
};

// Messages the client may send us.
type ClientMessage =
  | { type: 'setName'; name: string }
  | { type: 'toggleReady'; ready: boolean }
  | { type: 'start' };

const MAX_PLAYERS_PER_ROOM = 16;
const MAX_NAME_LENGTH = 24;
const MATCH_DURATION_MS = 5000;

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
  // names, ready flags, match phase) and a match-end timer in memory. An open
  // WebSocket keeps a non-hibernating DO resident, so the setTimeout below
  // reliably fires. Rooms are short-lived and active, so the cost is small.
  static options = { hibernate: false };

  private phase: Phase = 'lobby';
  private matchEndsAt: number | null = null;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-connection state, keyed by connection id.
  private playerState = new Map<string, { name: string; ready: boolean }>();

  onConnect(connection: Connection) {
    // getConnections() already includes the new one at this point;
    // close it back out if the room is over capacity. Limits per-room
    // blast radius once a DO is alive.
    if ([...this.getConnections()].length > MAX_PLAYERS_PER_ROOM) {
      connection.close(1013, 'Room full');
      return;
    }
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
      case 'start': {
        this.tryStartMatch();
        break;
      }
    }
  }

  onClose(connection: Connection) {
    this.playerState.delete(connection.id);
    this.broadcastState();
  }

  private ensurePlayer(id: string): { name: string; ready: boolean } {
    let entry = this.playerState.get(id);
    if (!entry) {
      entry = { name: 'Player', ready: false };
      this.playerState.set(id, entry);
    }
    return entry;
  }

  private currentPlayers(): Player[] {
    return [...this.getConnections()].map((c: Connection) => {
      const entry = this.ensurePlayer(c.id);
      return { id: c.id, name: entry.name, ready: entry.ready };
    });
  }

  private tryStartMatch() {
    if (this.phase !== 'lobby') return;
    const players = this.currentPlayers();
    if (players.length === 0 || !players.every((p) => p.ready)) return;

    this.phase = 'match';
    this.matchEndsAt = Date.now() + MATCH_DURATION_MS;
    this.broadcastState();

    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = setTimeout(() => this.endMatch(), MATCH_DURATION_MS);
  }

  private endMatch() {
    this.matchTimer = null;
    this.phase = 'lobby';
    this.matchEndsAt = null;
    // Everyone returns to the lobby un-readied.
    for (const entry of this.playerState.values()) {
      entry.ready = false;
    }
    this.broadcastState();
  }

  private broadcastState() {
    const message: RoomState = {
      type: 'state',
      phase: this.phase,
      matchEndsAt: this.matchEndsAt,
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
