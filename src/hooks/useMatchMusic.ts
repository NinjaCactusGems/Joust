import { useEffect, useRef } from 'react';
import musicUrl from '../assets/match-music.m4a';

const TARGET_VOLUME = 0.85;
const FADE_IN_MS = 200;
const FADE_OUT_MS = 800;

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
 * Plays the match soundtrack, looping, in sync across clients.
 *
 * Each time a new match starts (a fresh, non-null `matchEndsAt`), playback is
 * (re)seeked to `getOffsetSec()` — the one-way network latency (half the
 * round-trip) — so that, accounting for the time the start message spent in
 * flight, every client lands on the same position in the track.
 *
 * The track keeps looping after the match ends (through the lobby) so there is
 * no long gap between rounds. It fades out only when the next round starts
 * (a brief dip before re-syncing) or when the room is left (unmount).
 */
export function useMatchMusic(
  matchEndsAt: number | null,
  getOffsetSec: () => number,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelFadeRef = useRef<(() => void) | null>(null);
  const lastMatchRef = useRef<number | null>(null);

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

  // (Re)sync playback on each new match start.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (matchEndsAt == null || matchEndsAt === lastMatchRef.current) {
      // Match ended (kept looping) or an unrelated state update — do nothing.
      return;
    }
    lastMatchRef.current = matchEndsAt;
    cancelFadeRef.current?.();

    const begin = () => {
      const offset = Math.max(0, getOffsetSec());
      try {
        audio.currentTime = offset;
      } catch {
        // currentTime can throw before metadata is ready; the offset is tiny.
      }
      audio.volume = 0;
      void audio
        .play()
        .then(() => {
          cancelFadeRef.current = fade(audio, TARGET_VOLUME, FADE_IN_MS);
        })
        .catch(() => {
          // Autoplay still blocked (no gesture yet) — nothing to do.
        });
    };

    if (!audio.paused && audio.volume > 0.01) {
      // A round is already playing: dip out, then re-sync the new round.
      cancelFadeRef.current = fade(audio, 0, FADE_OUT_MS, begin);
    } else {
      begin();
    }
    // getOffsetSec is read lazily inside begin(); excluded to avoid restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchEndsAt]);
}
