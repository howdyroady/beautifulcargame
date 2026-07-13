/**
 * Synthesized V8 engine sound (CLS63-style burble) built entirely from WebAudio primitives.
 *
 * Layers:
 *  - two detuned sawtooth oscillators (fundamental + half-speed V8 lope)
 *  - brown noise through bandpass for exhaust rumble
 *  - tanh waveshaper for growl
 *  - throttle-driven lowpass
 *  - wind noise layer (highpass white noise scaling with speed)
 *  - tire screech (bandpass noise, pitch varies with speed)
 *
 * RPM faked with arcade "gears": pitch climbs within each ~42 km/h band then drops.
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
  private screechBp: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rpm = 0;
  // Starts muted: the oscillators run continuously once initialised (on the
  // first tap, which is a menu button), so without this the menu droned. Only
  // the driving modes call setEnabled(true).
  private enabled = false;

  /** Must be called from a user-gesture handler. Safe to call repeatedly. */
  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.16 : 0;
    this.master.connect(ctx.destination);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(2.8 * x);
    }
    shaper.curve = curve;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 1.4;

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
    this.osc2.detune.value = 10;
    const g2 = ctx.createGain();
    g2.gain.value = 0.75;
    this.osc2.connect(g2);
    g2.connect(this.engineGain);
    this.osc2.start();

    // Brown noise exhaust bed
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
    noiseBand.frequency.value = 440;
    noiseBand.Q.value = 0.9;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.15;
    noise.connect(noiseBand);
    noiseBand.connect(this.noiseGain);
    this.noiseGain.connect(shaper);
    noise.start();

    // Wind noise layer (always running, volume scales with speed)
    this.setupWindNoise(ctx);
  }

  private setupWindNoise(ctx: AudioContext) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = 800;
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.value = on ? 0.16 : 0;
  }

  /** Drive per frame with the player's speed (km/h), throttle (0..1), nitro state. */
  update(dt: number, speedKmh: number, throttle: number, nitroActive: boolean) {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    const gearSpan = 42;
    const inGear = (Math.max(0, speedKmh) % gearSpan) / gearSpan;
    const gearFloor = Math.min(0.55, Math.floor(Math.max(0, speedKmh) / gearSpan) * 0.09);
    const targetRpm = Math.min(1, 0.12 + gearFloor + inGear * 0.55 + (nitroActive ? 0.18 : 0));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 6);

    const f = 40 + this.rpm * 125;
    const now = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, now, 0.03);
    this.osc2.frequency.setTargetAtTime(f / 2, now, 0.03);
    this.filter.frequency.setTargetAtTime(220 + throttle * 1000 + this.rpm * 550, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.3 + throttle * 0.35 + this.rpm * 0.14, now, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.08 + this.rpm * 0.24, now, 0.05);

    // Wind noise scales with speed
    if (this.windGain && this.windFilter) {
      const windVol = Math.min(0.18, (speedKmh / 300) * 0.18);
      this.windGain.gain.setTargetAtTime(windVol, now, 0.1);
      this.windFilter.frequency.setTargetAtTime(600 + speedKmh * 4, now, 0.1);
    }
  }

  /** Continuous tire screech — pitch varies with speed for realism. */
  setScreech(active: boolean, speedKmh = 100) {
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
      this.screechBp = ctx.createBiquadFilter();
      this.screechBp.type = 'bandpass';
      this.screechBp.frequency.value = 1900;
      this.screechBp.Q.value = 4.5;
      this.screechGain = ctx.createGain();
      this.screechGain.gain.value = 0;
      src.connect(this.screechBp);
      this.screechBp.connect(this.screechGain);
      this.screechGain.connect(this.master);
      src.start();
    }
    // Pitch varies with speed: faster = higher screech
    if (this.screechBp) {
      const pitch = 1500 + Math.min(1200, speedKmh * 6);
      this.screechBp.frequency.setTargetAtTime(pitch, this.ctx.currentTime, 0.08);
    }
    this.screechGain.gain.setTargetAtTime(active ? 0.55 : 0, this.ctx.currentTime, 0.06);
  }

  /** Short rising hiss when nitro kicks in. */
  playNitro() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const dur = 0.6;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(500, ctx.currentTime);
    hp.frequency.linearRampToValueAtTime(3000, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start();
  }

  /**
   * Short mechanical "clunk" for a gear change (parking R/D/P). Routes straight
   * to the output, bypassing the (muted-in-parking) engine master so it's heard
   * even when the continuous engine drone is disabled.
   */
  playGearClick() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const dur = 0.12;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  /** Impact thud, intensity 0..1. */
  playCrash(intensity: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const dur = 0.3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.35 + 0.5 * Math.min(1, intensity);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
  }
}

/** Singleton engine sound, initialized on the first user gesture. */
export const engineSound = new EngineSound();
const initOnce = () => {
  engineSound.init();
  window.removeEventListener('pointerdown', initOnce);
  window.removeEventListener('keydown', initOnce);
};
window.addEventListener('pointerdown', initOnce);
window.addEventListener('keydown', initOnce);
