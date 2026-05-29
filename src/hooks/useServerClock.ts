import { useCallback, useEffect, useRef } from 'react';

// Minimal shape of the partysocket we need — send plus message listening.
interface ClockSocket {
  send(data: string): void;
  readyState: number;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
}

const MAX_SAMPLES = 8;

/**
 * Estimates the offset between this client's clock and the server's, so that
 * server-authoritative timestamps (e.g. `readyEndsAt`) can be converted to a
 * precise local instant and scheduled in step across every device in the room.
 *
 * It pings periodically; the server echoes the client's send time plus its own
 * clock. Using Cristian's algorithm, each round trip yields:
 *   rtt    = now - sentAt
 *   offset = serverTime - (sentAt + now) / 2     // serverTime − localTime
 * We keep the offset from the lowest-RTT recent sample, since the least-delayed
 * exchange gives the tightest estimate (half-RTT either way).
 *
 * `toLocalTime(serverTs)` maps a server timestamp into local `Date.now()` space.
 * Until the first pong (or against an un-upgraded server), the offset is 0, so
 * it falls back to assuming the clocks agree.
 */
export function useServerClock(socket: ClockSocket, connected: boolean) {
  const samplesRef = useRef<{ offset: number; rtt: number }[]>([]);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!connected) return;

    const onMessage = (event: MessageEvent) => {
      let data: { type?: string; t?: number; serverTime?: number };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        data.type !== 'pong' ||
        typeof data.t !== 'number' ||
        typeof data.serverTime !== 'number'
      ) {
        return;
      }
      const now = Date.now();
      const rtt = now - data.t;
      if (rtt < 0 || rtt > 10000) return;
      const offset = data.serverTime - (data.t + now) / 2;

      const samples = samplesRef.current;
      samples.push({ offset, rtt });
      if (samples.length > MAX_SAMPLES) samples.shift();
      // Trust the offset from the least-delayed recent round trip.
      let best = samples[0];
      for (const s of samples) if (s.rtt < best.rtt) best = s;
      offsetRef.current = best.offset;
    };

    socket.addEventListener('message', onMessage);

    const ping = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    };
    // A quick burst to converge fast, then a steady trickle to track drift.
    ping();
    const timers = [
      window.setTimeout(ping, 200),
      window.setTimeout(ping, 500),
      window.setTimeout(ping, 1200),
    ];
    const interval = window.setInterval(ping, 5000);

    return () => {
      socket.removeEventListener('message', onMessage);
      timers.forEach((id) => window.clearTimeout(id));
      window.clearInterval(interval);
    };
  }, [socket, connected]);

  // Map a server timestamp into this client's Date.now() space.
  const toLocalTime = useCallback(
    (serverTs: number) => serverTs - offsetRef.current,
    [],
  );

  return { toLocalTime };
}
