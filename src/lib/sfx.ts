// Sound effects synthesized with the Web Audio API — no audio files to ship.
// The context is created lazily and resumed on demand; by the time any SFX
// plays the player has already interacted (tapped "I'm ready"/"Start"), which
// satisfies the browser autoplay policy.

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
  // The moment you're eliminated: a microphone yanked from the jack. Layers a
  // sharp click (the plug pull), a deep body thump with a sub-bass drop, a
  // feedback growl that is hard-gated to silence mid-cry (rather than decaying),
  // and an electrical static burst — the harsh layers run through soft clipping
  // for bite. Tuned to land low and loud: a gut-punch rather than a shriek.
  screech() {
    const ac = getCtx();
    if (!ac) return;
    const now = ac.currentTime;

    // Soft clipper + master, shared by the harsh layers.
    const shaper = ac.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(3 * x);
    }
    shaper.curve = curve;
    const master = ac.createGain();
    master.gain.value = 0.95; // louder overall
    shaper.connect(master).connect(ac.destination);

    // 1) Sharp click/pop transient — the physical plug-pull "thunk".
    const click = ac.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(620, now);
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(0.9, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    click.connect(clickGain).connect(shaper);
    click.start(now);
    click.stop(now + 0.02);

    // 2) Low body thump (kept round — bypasses the clipper). The dominant
    // layer, so the screech reads as a deep "thunk" rather than a high cry.
    // Deeper and longer than before for more weight.
    const thump = ac.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(30, now + 0.2);
    const thumpGain = ac.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(1.3, now + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    thump.connect(thumpGain).connect(master);
    thump.start(now);
    thump.stop(now + 0.32);

    // 2b) Sub-bass drop felt more than heard — adds depth under the thump.
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.26);
    const subGain = ac.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.9, now + 0.012);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    sub.connect(subGain).connect(master);
    sub.start(now);
    sub.stop(now + 0.36);

    // 3) Feedback growl that abruptly cuts to silence (gated), not decays.
    // Pitched well down so it growls low rather than shrieks.
    const squealDur = 0.13;
    const squeal = ac.createOscillator();
    squeal.type = 'sawtooth';
    squeal.frequency.setValueAtTime(520, now);
    squeal.frequency.linearRampToValueAtTime(700, now + squealDur);
    const squealGain = ac.createGain();
    squealGain.gain.setValueAtTime(0.0001, now);
    squealGain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
    squealGain.gain.setValueAtTime(0.4, now + squealDur - 0.001); // hold full…
    squealGain.gain.setValueAtTime(0.0001, now + squealDur); // …then hard cut
    squeal.connect(squealGain).connect(shaper);
    squeal.start(now);
    squeal.stop(now + squealDur + 0.01);

    // 4) Electrical static burst (low-rumble flavour).
    const noiseDur = 0.1;
    const noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * noiseDur), ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
    noise.connect(hp).connect(noiseGain).connect(shaper);
    noise.start(now);
    noise.stop(now + noiseDur);
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
