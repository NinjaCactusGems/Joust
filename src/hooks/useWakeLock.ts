import { useEffect } from 'react';

// Minimal shape of the Screen Wake Lock API (not in every lib.dom yet).
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Holds a screen wake lock while `enabled`, so the phone doesn't dim and slip
 * into standby during a session. That matters here because going to standby
 * hides the page, which the room reports as "away" — knocking a player out of
 * the ready gate (and, mid-round, making them briefly stop playing).
 *
 * The platform releases the lock automatically whenever the page is hidden, so
 * we re-acquire on `visibilitychange` once it's visible again. No-ops where the
 * API is missing (e.g. older Safari) or the request is rejected.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        sentinel = await nav.wakeLock!.request('screen');
        // Unmounted while the request was in flight — let it go.
        if (cancelled) {
          void sentinel.release();
          sentinel = null;
        }
      } catch {
        // Rejected (page not visible, low battery, unsupported) — ignore.
      }
    };

    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
      sentinel = null;
    };
  }, [enabled]);
}
