import { useEffect, useState } from 'react';

// Full-screen placeholder match scene: a countdown to the server-provided end
// time. Purely presentational — the server flips the room back to the lobby and
// resets ready states when the match ends.
export function Match({ endsAt }: { endsAt: number }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [endsAt]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-staff text-ink">
      <div className="text-sm font-semibold uppercase tracking-[0.3em] text-go">
        Match in progress
      </div>
      {secondsLeft > 0 ? (
        <div className="font-serif text-8xl font-bold tabular-nums">
          {secondsLeft}
        </div>
      ) : (
        <div className="font-serif text-6xl font-bold tracking-tight text-go">
          GO!
        </div>
      )}
      <div className="text-sm text-ink-muted">Returning to the lobby…</div>
    </div>
  );
}
