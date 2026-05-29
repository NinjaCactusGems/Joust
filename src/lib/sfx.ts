// Sound effects. Reactions are synthesized with the Web Audio API; the applause
// and elimination cues are short sampled clips, decoded once and played through
// the same context. The context is created lazily and resumed on demand; by the
// time any SFX plays the player has already interacted (tapped "I'm
// ready"/"Start"), which satisfies the browser autoplay policy.

import applauseUrl from '../assets/applause.mp3';
import eliminateUrl from '../assets/eliminate.mp3';

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Decode a sampled clip once and cache the (promise of the) AudioBuffer, so each
// cue is fetched/decoded a single time and replayed instantly thereafter.
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
function loadBuffer(ac: AudioContext, url: string): Promise<AudioBuffer | null> {
  let cached = bufferCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => ac.decodeAudioData(data))
      .catch(() => null);
    bufferCache.set(url, cached);
  }
  return cached;
}

// Short melodic blip per reaction — distinct enough to tell apart by ear, all
// played on every device when any player taps a smiley.
const REACTION_NOTES: Record<
  string,
  { type: OscillatorType; freqs: number[]; step: number; dur: number; gain: number }
> = {
  turd: { type: 'triangle', freqs: [380, 240, 130], step: 0.05, dur: 0.12, gain: 0.28 }, // descending "blop"
  heart: { type: 'sine', freqs: [523, 784], step: 0.1, dur: 0.18, gain: 0.26 }, // two soft rising notes
  dancer: { type: 'square', freqs: [392, 523, 659], step: 0.06, dur: 0.1, gain: 0.16 }, // bouncy arpeggio up
  dancerF: { type: 'sine', freqs: [587, 740, 988], step: 0.06, dur: 0.1, gain: 0.22 }, // brighter arpeggio up
};

export const sfx = {
  // Looping applause clip, started on every losing phone for the length of the
  // winner celebration. Each phone plays it at a slightly randomized pitch +
  // speed so a roomful of phones doesn't loop in lockstep — the offsets blend
  // into a natural, sustained crowd. Returns a stopper the caller runs to end it
  // (the winner's own phone never starts it).
  applause(): () => void {
    const ac = getCtx();
    if (!ac) return () => {};
    let stopped = false;
    let src: AudioBufferSourceNode | null = null;
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    gain.connect(ac.destination);
    void loadBuffer(ac, applauseUrl).then((buf) => {
      if (!buf || stopped) return;
      src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2; // 0.9–1.1× (pitch + speed)
      src.connect(gain);
      src.start();
    });
    return () => {
      stopped = true;
      if (src) {
        try {
          src.stop();
        } catch {
          // already stopped
        }
        src.disconnect();
      }
      gain.disconnect();
    };
  },

  // The moment you're eliminated: a guitar/amp "yank" clip, played once at a
  // slight random pitch so repeated eliminations don't sound identical.
  screech() {
    const ac = getCtx();
    if (!ac) return;
    void loadBuffer(ac, eliminateUrl).then((buf) => {
      if (!buf) return;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.94 + Math.random() * 0.12; // ~±1 semitone
      const gain = ac.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(ac.destination);
      src.start();
    });
  },

  // A smiley tap: plays on every device (wired to the broadcast reaction event).
  reaction(name: string) {
    const spec = REACTION_NOTES[name];
    if (!spec) return;
    const ac = getCtx();
    if (!ac) return;
    const now = ac.currentTime;
    spec.freqs.forEach((f, i) => {
      const t0 = now + i * spec.step;
      const osc = ac.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(f, t0);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + spec.dur + 0.02);
    });
  },
};

