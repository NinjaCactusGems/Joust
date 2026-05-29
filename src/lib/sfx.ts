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

export const sfx = {
  // A harsh, descending screech for the moment you're eliminated ("you moved!").
  // A detuned sawtooth swept downward with fast vibrato, mixed with a swept
  // band-passed noise burst, all run through soft clipping for bite.
  screech() {
    const ac = getCtx();
    if (!ac) return;
    const now = ac.currentTime;
    const dur = 0.5;

    // Master envelope: fast attack, exponential decay.
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    master.connect(ac.destination);

    // Soft clipper for harshness.
    const shaper = ac.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(3 * x);
    }
    shaper.curve = curve;
    shaper.connect(master);

    // Descending sawtooth tone.
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + dur);
    const oscGain = ac.createGain();
    oscGain.gain.value = 0.5;
    osc.connect(oscGain).connect(shaper);

    // Fast vibrato makes it "screech" rather than just sweep.
    const lfo = ac.createOscillator();
    lfo.frequency.value = 32;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain).connect(osc.frequency);

    // Swept band-passed noise burst layered on top.
    const noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    bp.frequency.setValueAtTime(2600, now);
    bp.frequency.exponentialRampToValueAtTime(500, now + dur);
    const noiseGain = ac.createGain();
    noiseGain.gain.value = 0.35;
    noise.connect(bp).connect(noiseGain).connect(shaper);

    osc.start(now);
    lfo.start(now);
    noise.start(now);
    osc.stop(now + dur);
    lfo.stop(now + dur);
    noise.stop(now + dur);
  },
};
