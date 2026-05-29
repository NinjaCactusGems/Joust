import { Server, routePartykitRequest, type Connection } from 'partyserver';

type Phase = 'lobby' | 'ready' | 'jousting' | 'winner';

type Reaction = 'turd' | 'heart' | 'dancer' | 'dancerF';

// Tempo shifts during jousting: the music speed and shake sensitivity change
// for the whole room at once. See src/lib/tempo.ts for the client-side targets.
type Tempo = 'normal' | 'fast' | 'slow';

// Team identifiers (exotic cute animals). The id list is duplicated here from
// src/lib/teams.ts (which also carries the labels/colors the client renders),
// mirroring how REACTIONS is duplicated — the server only needs to validate ids.
type TeamId =
  | 'axolotl'
  | 'quokka'
  | 'pangolin'
  | 'fennec'
  | 'redpanda'
  | 'sugarglider'
  | 'capybara'
  | 'narwhal';

type Player = {
  id: string;
  name: string;
  ready: boolean;
  eliminated: boolean;
  away: boolean;
  team: TeamId | null;
};

type RoomState = {
  type: 'state';
  phase: Phase;
  readyEndsAt: number | null;
  winnerEndsAt: number | null;
  winnerId: string | null;
  // The winning team when a group wins (all survivors share one team); null when
  // a lone survivor wins (winnerId carries them instead). See checkWinCondition.
  winnerTeam: TeamId | null;
  // Current jousting tempo and the server time it takes effect (announced a
  // touch ahead so every client can schedule the flip in lockstep). Outside
  // jousting this is always normal / null.
  tempo: Tempo;
  tempoEffectiveAt: number | null;
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
  | { type: 'setTeam'; team: TeamId | null }
  | { type: 'toggleReady'; ready: boolean }
  | { type: 'visibility'; visible: boolean }
  | { type: 'start' }
  | { type: 'eliminate' }
  | { type: 'reaction'; reaction: Reaction }
  | { type: 'ping'; t: number };

const MAX_PLAYERS_PER_ROOM = 32;
const MAX_NAME_LENGTH = 24;
const READY_DURATION_MS = 5000;
const WINNER_DURATION_MS = 10000;
const REACTIONS: readonly Reaction[] = ['turd', 'heart', 'dancer', 'dancerF'];
const TEAM_IDS: readonly TeamId[] = [
  'axolotl',
  'quokka',
  'pangolin',
  'fennec',
  'redpanda',
  'sugarglider',
  'capybara',
  'narwhal',
];
// Teams only matter once the room is at least this big; below it, every player
// is treated as their own side (preserving the free-for-all and solo+Johann
// behaviour). Captured at game start as `teamsActive`.
const MIN_PLAYERS_FOR_TEAMS = 3;

// When you start a round alone, Johann joins as a virtual opponent so the solo
// nerve game isn't an instant win. He never moves, so he's never eliminated and
// wins the moment the lone human twitches out.
const BOT_NAME = 'Johann';
const BOT_ID = 'bot-johann'; // never collides with UUID connection ids

// Each tempo phase holds 10–15s; changes are announced this far ahead so every
// client receives them before the synced flip.
const TEMPO_HOLD_MIN_MS = 10000;
const TEMPO_HOLD_MAX_MS = 15000;
const TEMPO_LEAD_MS = 500;

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
  private winnerTeam: TeamId | null = null;
  // Whether team rules apply to the in-progress (or just-finished) round.
  // Captured at start from the active player count so a mid-round disconnect
  // can't flip the win logic. Cleared in resetToLobby.
  private teamsActive = false;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private tempo: Tempo = 'normal';
  private tempoEffectiveAt: number | null = null;
  private tempoTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when a lone player starts a round: Johann joins as a virtual player for
  // that round only. Cleared back to lobby on reset. See BOT_NAME above.
  private botActive = false;
  // Per-connection state, keyed by connection id.
  private playerState = new Map<
    string,
    {
      name: string;
      ready: boolean;
      eliminated: boolean;
      visible: boolean;
      team: TeamId | null;
    }
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
      case 'setTeam': {
        // Picking a team is a lobby decision. Accept a clear (null) or a known
        // team id; ignore anything else.
        if (this.phase !== 'lobby') return;
        const team = msg.team;
        if (team !== null && !TEAM_IDS.includes(team)) return;
        const entry = this.ensurePlayer(connection.id);
        entry.team = team;
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
      case 'ping': {
        // Clock sync: echo the client's send time plus our own clock, so the
        // client can estimate round-trip time and its offset from server time
        // (Cristian's algorithm) and schedule synced events like match start.
        if (typeof msg.t === 'number') {
          connection.send(
            JSON.stringify({ type: 'pong', t: msg.t, serverTime: Date.now() }),
          );
        }
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
    team: TeamId | null;
  } {
    let entry = this.playerState.get(id);
    if (!entry) {
      entry = {
        name: 'Player',
        ready: false,
        eliminated: false,
        visible: true,
        team: null,
      };
      this.playerState.set(id, entry);
    }
    return entry;
  }

  private currentPlayers(): Player[] {
    const players = [...this.getConnections()].map((c: Connection) => {
      const entry = this.ensurePlayer(c.id);
      return {
        id: c.id,
        name: entry.name,
        ready: entry.ready,
        eliminated: entry.eliminated,
        away: !entry.visible,
        team: entry.team,
      };
    });
    if (this.botActive) {
      players.push({
        id: BOT_ID,
        name: BOT_NAME,
        ready: true,
        eliminated: false, // Johann never moves → never out → always wins
        away: false,
        team: null,
      });
    }
    return players;
  }

  // A player's "side" this round. With teams active, teammates collapse to one
  // side; teamless players (and everyone when teams are off) are a side of one,
  // so they win alone.
  private factionKey(p: Player, teamsActive: boolean): string {
    return teamsActive && p.team ? `team:${p.team}` : `solo:${p.id}`;
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

    // Teams only count with enough people; otherwise it's a free-for-all.
    this.teamsActive = active.length >= MIN_PLAYERS_FOR_TEAMS;
    // Need at least two distinct sides to play — block the degenerate "everyone
    // on one team" start. A lone player is exempt (Johann fills in below).
    const factions = new Set(
      active.map((p) => this.factionKey(p, this.teamsActive)),
    );
    if (active.length > 1 && factions.size < 2) return;

    // Lone starter? Johann joins so they actually have to win it. (botActive is
    // still false here, so `active` counts only human connections.)
    this.botActive = active.length === 1;

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
    // Always start at normal, effective right at "GO", then begin the cycle.
    this.tempo = 'normal';
    this.tempoEffectiveAt = Date.now();
    this.broadcastState();
    this.tempoTimer = setTimeout(() => this.applyNextTempo(), this.randTempoHold());
    // A solo room (or one already down to a single player) resolves at once
    // rather than hanging in jousting forever.
    this.checkWinCondition();
  }

  private randTempoHold(): number {
    return (
      TEMPO_HOLD_MIN_MS + Math.random() * (TEMPO_HOLD_MAX_MS - TEMPO_HOLD_MIN_MS)
    );
  }

  // Next tempo: from normal, shift to fast or slow; from a shift, usually
  // settle back to normal, occasionally jump to the other extreme for variety.
  // Never repeats the current tempo, so every change is audible.
  private pickNextTempo(current: Tempo): Tempo {
    if (current === 'normal') return Math.random() < 0.5 ? 'fast' : 'slow';
    if (Math.random() < 0.7) return 'normal';
    return current === 'fast' ? 'slow' : 'fast';
  }

  private applyNextTempo() {
    if (this.phase !== 'jousting') return;
    this.tempo = this.pickNextTempo(this.tempo);
    // Announce slightly ahead so every client can schedule the synced flip.
    this.tempoEffectiveAt = Date.now() + TEMPO_LEAD_MS;
    this.broadcastState();
    this.tempoTimer = setTimeout(
      () => this.applyNextTempo(),
      TEMPO_LEAD_MS + this.randTempoHold(),
    );
  }

  private stopTempo() {
    if (this.tempoTimer) {
      clearTimeout(this.tempoTimer);
      this.tempoTimer = null;
    }
    this.tempo = 'normal';
    this.tempoEffectiveAt = null;
  }

  private checkWinCondition() {
    if (this.phase !== 'jousting') return;
    const alive = this.currentPlayers().filter((p) => !p.eliminated);
    // The round resolves once everyone left belongs to a single side.
    const factions = new Set(
      alive.map((p) => this.factionKey(p, this.teamsActive)),
    );
    if (factions.size > 1) return;

    this.stopTempo();
    this.phase = 'winner';
    // A team wins as a group; a teamless survivor (or any winner when teams are
    // off) wins alone via winnerId.
    const survivor = alive[0] ?? null;
    if (this.teamsActive && survivor?.team) {
      this.winnerTeam = survivor.team;
      this.winnerId = null;
    } else {
      this.winnerTeam = null;
      this.winnerId = survivor?.id ?? null;
    }
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
    this.stopTempo();
    this.phase = 'lobby';
    this.readyEndsAt = null;
    this.winnerEndsAt = null;
    this.winnerId = null;
    this.winnerTeam = null;
    this.teamsActive = false;
    this.botActive = false;
    // Everyone returns to the lobby un-readied and back in the game. Team picks
    // persist across rounds (only the per-round flags reset).
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
      winnerTeam: this.winnerTeam,
      tempo: this.tempo,
      tempoEffectiveAt: this.tempoEffectiveAt,
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
