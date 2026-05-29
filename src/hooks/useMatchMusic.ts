import { useEffect, useRef } from 'react';
import musicUrl from '../assets/match-music.m4a';

const TARGET_VOLUME = 0.85;
const FADE_IN_MS = 250;
const FADE_OUT_MS = 600;
const MUTE_FADE_MS = 250;

/**
 * Ramp an audio element's volume to `target` over `ms`, then run `onDone`.
 * Returns a canceller for the in-flight ramp.
 */
function fade(
  audio: HTMLAudioElement,
  target: number,
  ms: number,
  onDone?: () => void,
): () => void {
  const from = audio.volume;
  const startedAt = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const k = ms <= 0 ? 1 : Math.min(1, (now - startedAt) / ms);
    audio.volume = Math.max(0, Math.min(1, from + (target - from) * k));
    if (k < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      onDone?.();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * Plays the match soundtrack, looping.
 *
 * Playback begins exactly when the "Get Ready" countdown hits zero — i.e. at
 * `readyEndsAt` (the moment jousting starts / "GO"). Each client schedules the
 * start against its own clock, so the music drops in step with the countdown
 * the player sees, and stays in step across devices to within their clock skew.
 *
 * The track keeps looping through the round, the winner screen, and the lobby
 * so there is no gap between rounds; each new round re-seeks it to the start at
 * "GO" to re-sync. It fades out only when the room is left (unmount).
 *
 * Eliminated players hear nothing: the soundtrack fades to silent while
 * `eliminated` is true and fades back when they re-enter the next round.
 */
export function useMatchMusic(readyEndsAt: number | null, eliminated: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelFadeRef = useRef<(() => void) | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const lastRoundRef = useRef<number | null>(null);
  const eliminatedRef = useRef(eliminated);
  eliminatedRef.current = eliminated;

  // Create the element once and unlock autoplay on the first user gesture.
  useEffect(() => {
    const audio = new Audio(musicUrl);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audioRef.current = audio;

    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      audio.muted = true;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      cancelFadeRef.current?.();
      if (startTimerRef.current) window.clearTimeout(startTimerRef.current);
      // Leaving the room: fade out, independent of React, then release.
      if (!audio.paused) {
        fade(audio, 0, FADE_OUT_MS, () => {
          audio.pause();
          audio.src = '';
        });
      } else {
        audio.src = '';
      }
      audioRef.current = null;
    };
  }, []);

  // Start (or re-sync) playback exactly when the countdown reaches zero.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (readyEndsAt == null || readyEndsAt === lastRoundRef.current) return;
    lastRoundRef.current = readyEndsAt;

    const begin = () => {
      startTimerRef.current = null;
      cancelFadeRef.current?.();
      try {
        audio.currentTime = 0; // seek to the top so every client is aligned
      } catch {
        // currentTime can throw before metadata is ready; ignore.
      }
      audio.muted = false;
      audio.volume = 0;
      void audio
        .play()
        .then(() => {
          if (eliminatedRef.current) return; // out already — stay silent
          cancelFadeRef.current = fade(audio, TARGET_VOLUME, FADE_IN_MS);
        })
        .catch(() => {
          // Autoplay still blocked (no gesture yet) — nothing to do.
        });
    };

    if (startTimerRef.current) window.clearTimeout(startTimerRef.current);
    const delay = Math.max(0, readyEndsAt - Date.now());
    startTimerRef.current = window.setTimeout(begin, delay);

    return () => {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [readyEndsAt]);

  // Mute the soundtrack for eliminated players; restore when back in the round.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    cancelFadeRef.current?.();
    cancelFadeRef.current = fade(
      audio,
      eliminated ? 0 : TARGET_VOLUME,
      MUTE_FADE_MS,
    );
  }, [eliminated]);
}
