import { useEffect, useRef } from 'react';
import musicUrl from '../assets/match-music.m4a';
import { useSyncedTempo } from './useSyncedTempo';
import { TEMPO_RATE, type Tempo } from '../lib/tempo';

const TARGET_VOLUME = 0.85;
const FADE_IN_MS = 250;
const FADE_OUT_MS = 600;
const MUTE_FADE_MS = 250;
const RATE_RAMP_MS = 450;

// Older Safari/Firefox spell preservesPitch differently.
interface PitchPreservingAudio extends HTMLAudioElement {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
}

/** Glide an audio element's playbackRate to `target` over `ms` (clamped). */
function rampRate(audio: HTMLAudioElement, target: number, ms: number): () => void {
  const from = audio.playbackRate;
  const startedAt = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const k = ms <= 0 ? 1 : Math.min(1, (now - startedAt) / ms);
    audio.playbackRate = Math.max(0.25, Math.min(4, from + (target - from) * k));
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

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
 * `readyEndsAt`, the server-authoritative moment jousting starts / "GO". The
 * server broadcasts that timestamp ~5s ahead of time; `toLocalTime` (from
 * useServerClock) converts it into this client's clock so every device in the
 * room starts at the same real instant, irrespective of clock skew.
 *
 * The track keeps looping through the round and the winner screen. It fades out
 * whenever `active` goes false — the caller holds that true through the post-game
 * celebration and drops it as the lobby panel fades back in — so the soundtrack
 * carries the transition but never bleeds into the lobby before the next match.
 * Each new round re-seeks it to the start at "GO" to re-sync. It also fades out
 * when the room is left (unmount).
 *
 * Eliminated players hear nothing: the soundtrack fades to silent while
 * `eliminated` is true and fades back when they re-enter the next round.
 */
export function useMatchMusic(
  readyEndsAt: number | null,
  eliminated: boolean,
  toLocalTime: (serverTs: number) => number,
  tempo: Tempo,
  tempoEffectiveAt: number | null,
  active: boolean,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelFadeRef = useRef<(() => void) | null>(null);
  const cancelRateRef = useRef<(() => void) | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const lastRoundRef = useRef<number | null>(null);
  const eliminatedRef = useRef(eliminated);
  eliminatedRef.current = eliminated;

  // Create the element once and unlock autoplay on the first user gesture.
  useEffect(() => {
    const audio = new Audio(musicUrl) as PitchPreservingAudio;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    // Preserve pitch so tempo shifts read as a clean time-stretch effect
    // rather than a pitched-up/down tape warble.
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
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
      cancelRateRef.current?.();
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

    // The "Get Ready" countdown has just begun (readyEndsAt is ~5s ahead).
    // Silence anything still playing — e.g. the previous winner's looping
    // track — so the countdown is quiet on every device, then begin() restarts
    // everyone together at "GO".
    cancelFadeRef.current?.();
    if (!audio.paused) {
      cancelFadeRef.current = fade(audio, 0, FADE_OUT_MS, () => audio.pause());
    }

    const begin = () => {
      startTimerRef.current = null;
      cancelFadeRef.current?.();
      cancelRateRef.current?.();
      try {
        audio.currentTime = 0; // seek to the top so every client is aligned
      } catch {
        // currentTime can throw before metadata is ready; ignore.
      }
      audio.playbackRate = TEMPO_RATE.normal; // rounds always begin at normal
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
    // readyEndsAt is in server time; convert to this client's clock so all
    // devices fire at the same real instant.
    const delay = Math.max(0, toLocalTime(readyEndsAt) - Date.now());
    startTimerRef.current = window.setTimeout(begin, delay);

    return () => {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [readyEndsAt, toLocalTime]);

  // active=false — the room has settled back into the lobby — so stop the
  // soundtrack. Without this it would keep looping for the last survivor (whose
  // track was never silenced by elimination) while everyone waits to start
  // again. The next round's GO restart brings it back.
  useEffect(() => {
    if (active) return;
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    cancelFadeRef.current?.();
    cancelFadeRef.current = fade(audio, 0, FADE_OUT_MS, () => audio.pause());
  }, [active]);

  // Silence the soundtrack for this player the moment they're eliminated. We
  // never fade it back up here: once you're out you stay silent for the rest of
  // the round AND through resetToLobby() (which clears every `eliminated` flag,
  // which used to make the whole room's music swell back in at match end). The
  // next round's GO restart — begin() above — is the only thing that brings
  // music back, and only for players who aren't eliminated at that point.
  useEffect(() => {
    if (!eliminated) return;
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    cancelFadeRef.current?.();
    cancelFadeRef.current = fade(audio, 0, MUTE_FADE_MS);
  }, [eliminated]);

  // Shift the playback rate in lockstep with the room when the tempo changes.
  useSyncedTempo(tempo, tempoEffectiveAt, toLocalTime, (next) => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelRateRef.current?.();
    cancelRateRef.current = rampRate(audio, TEMPO_RATE[next], RATE_RAMP_MS);
  });
}
