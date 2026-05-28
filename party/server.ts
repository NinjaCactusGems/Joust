import { Server, routePartykitRequest, type Connection } from 'partyserver';

type PresenceMessage = { type: 'presence'; players: string[] };

export class Main extends Server {
  static options = { hibernate: true };

  onConnect() {
    this.broadcastPresence();
  }

  onClose() {
    this.broadcastPresence();
  }

  private broadcastPresence() {
    const players = [...this.getConnections()].map((c: Connection) => c.id);
    const message: PresenceMessage = { type: 'presence', players };
    this.broadcast(JSON.stringify(message));
  }
}

type Env = { Main: DurableObjectNamespace };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, DurableObjectNamespace>)) ||
      new Response('Not found', { status: 404 })
    );
  },
};
