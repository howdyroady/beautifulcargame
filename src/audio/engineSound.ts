/**
 * Synthesized V8 engine sound (CLS63-style burble) built entirely from WebAudio primitives —
 * no audio assets needed, so the game stays a single static bundle.
 *
 * Layers:
 *  - two detuned sawtooth oscillators (fundamental + half-speed "lope" that gives the V8 cadence)
 *  - looped brown noise through a bandpass for exhaust rumble
 *  - a tanh waveshaper for growl, and a throttle-driven lowpass so lifting off muffles the note
 *
 * RPM is faked with arcade "gears": pitch climbs within each ~45 km/h band then drops, which sells
 * acceleration far better than a linear speed→pitch mapping.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private engineGain!: GainNode;
  private filter!: BiquadFilterNode;
  private noiseGain!: GainNode;
  private screechGain: GainNode | null = null;
  private rpm = 0;
  private enabled = true;

  /** Must be called from a user-gesture handler (browser autoplay policy). Safe to call repeatedly. */
  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.14;
    this.master.connect(ctx.destination);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(2.4 * x);
    }
    shaper.curve = curve;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 1.2;

    shaper.connect(this.filter);
    this.filter.connect(this.master);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.5;
    this.engineGain.connect(shaper);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 55;
    this.osc1.connect(this.engineGain);
    this.osc1.start();

    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.value = 27.5;
    this.osc2.detune.value = 8;
    const g2 = ctx.createGain();
    g2.gain.value = 0.7;
    this.osc2.connect(g2);
    g2.connect(this.engineGain);
    this.osc2.start();

    // Brown noise exhaust bed.
    const bufferLen = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferLen; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 420;
    noiseBand.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.15;
    noise.connect(noiseBand);
    noiseBand.connect(this.noiseGain);
    this.noiseGain.connect(shaper);
    noise.start();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.value = on ? 0.14 : 0;
  }

  /** Drive per frame with the player's speed (km/h), throttle amount (0..1) and nitro state. */
  update(dt: number, speedKmh: number, throttle: number, nitroActive: boolean) {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    const gearSpan = 45;
    const inGear = (Math.max(0, speedKmh) % gearSpan) / gearSpan; // 0..1 within the fake gear
    const gearFloor = Math.min(0.55, Math.floor(Math.max(0, speedKmh) / gearSpan) * 0.08);
    const targetRpm = Math.min(1, 0.12 + gearFloor + inGear * 0.55 + (nitroActive ? 0.15 : 0));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 6);

    const f = 42 + this.rpm * 118; // ~42Hz idle to ~160Hz redline
    const now = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, now, 0.03);
    this.osc2.frequency.setTargetAtTime(f / 2, now, 0.03);
    this.filter.frequency.setTargetAtTime(240 + throttle * 900 + this.rpm * 500, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.32 + throttle * 0.3 + this.rpm * 0.12, now, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.08 + this.rpm * 0.22, now, 0.05);
  }

  /** Continuous tire screech, faded in/out — call every frame with whether the car is sliding. */
  setScreech(active: boolean) {
    if (!this.ctx || !this.enabled) return;
    if (!this.screechGain) {
      const ctx = this.ctx;
      const len = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 5;
      this.screechGain = ctx.createGain();
      this.screechGain.gain.value = 0;
      src.connect(bp);
      bp.connect(this.screechGain);
      this.screechGain.connect(this.master);
      src.start();
    }
    this.screechGain.gain.setTargetAtTime(active ? 0.5 : 0, this.ctx.currentTime, 0.08);
  }

  /** Short rising hiss when nitro kicks in. */
  playNitro() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const dur = 0.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(600, ctx.currentTime);
    hp.frequency.linearRampToValueAtTime(2600, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start();
  }

  /** Impact thud, intensity 0..1. */
  playCrash(intensity: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const dur = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    const g = ctx.createGain();
    g.gain.value = 0.3 + 0.5 * Math.min(1, intensity);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
  }
}

/** Singleton engine sound, initialized on the first user gesture anywhere in the app. */
export const engineSound = new EngineSound();
const initOnce = () => {
  engineSound.init();
  window.removeEventListener('pointerdown', initOnce);
  window.removeEventListener('keydown', initOnce);
};
window.addEventListener('pointerdown', initOnce);
window.addEventListener('keydown', initOnce);
