/**
 * Every sound in Shadow Play is synthesized with the Web Audio API: no audio
 * files, nothing to download, nothing licensed.
 */
export class Sfx {
  private ctx: AudioContext | undefined;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private chimeOsc: OscillatorNode | undefined;
  private chimeGain: GainNode | undefined;
  private humStarted = false;

  /** Must be called from (or after) a user gesture: click, key, or XR session start. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startAmbience();
  }

  private get now(): number {
    return this.ctx!.currentTime;
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, release: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, peak: number, dest: AudioNode = this.master): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g, t, peak, 0.01, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, filterType: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.005): BiquadFilterNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
    return f;
  }

  /** Low room hum + occasional candle crackle, forever. */
  private startAmbience(): void {
    if (!this.ctx || this.humStarted) return;
    this.humStarted = true;
    const ctx = this.ctx;
    const hum = ctx.createGain();
    hum.gain.value = 0.045;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.connect(hum).connect(this.master);
    for (const f of [55, 55.4, 82.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 60 ? 0.25 : 0.5;
      o.connect(g).connect(lp);
      o.start();
    }
    const crackle = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') {
        this.noise(this.now, 0.03 + Math.random() * 0.04, 'bandpass', 1800 + Math.random() * 2500, 2, 0.05 + Math.random() * 0.05);
      }
      setTimeout(crackle, 300 + Math.random() * 1800);
    };
    setTimeout(crackle, 800);
  }

  /** Rising chime tied to a hold-ring's fill (0..1). Call every frame; 0 silences it. */
  setChime(progress: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (progress <= 0.001) {
      if (this.chimeGain) {
        this.chimeGain.gain.setTargetAtTime(0, this.now, 0.05);
        const o = this.chimeOsc!;
        setTimeout(() => o.stop(), 300);
        this.chimeOsc = undefined;
        this.chimeGain = undefined;
      }
      return;
    }
    if (!this.chimeOsc) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      // Gentle vibrato makes the drone feel alive.
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 5.5;
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain).connect(o.frequency);
      lfo.start();
      o.connect(g).connect(this.master);
      o.start();
      o.onended = () => lfo.stop();
      this.chimeOsc = o;
      this.chimeGain = g;
    }
    // Pentatonic-ish glide from A4 up an octave and a fifth.
    this.chimeOsc.frequency.setTargetAtTime(440 * Math.pow(2, progress * 1.6), this.now, 0.04);
    this.chimeGain!.gain.setTargetAtTime(0.03 + progress * 0.09, this.now, 0.05);
  }

  /** Transformation success: bright arpeggio + shimmer. */
  success(): void {
    if (!this.ctx) return;
    const t = this.now;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this.tone(f, t + i * 0.07, 0.9, 'triangle', 0.16);
      this.tone(f * 2, t + i * 0.07, 0.5, 'sine', 0.04);
    });
    this.noise(t, 0.8, 'highpass', 6000, 0.7, 0.05, 0.05);
  }

  /** Soft UI tick (pinch buttons, menu open). */
  click(): void {
    if (!this.ctx) return;
    this.tone(880, this.now, 0.12, 'sine', 0.12);
    this.tone(1320, this.now + 0.04, 0.1, 'sine', 0.06);
  }

  /** Two barks: noisy formant burst with a falling pitch. */
  bark(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const t = this.now + i * 0.28;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.16);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1100, t);
      bp.frequency.exponentialRampToValueAtTime(600, t + 0.16);
      bp.Q.value = 3;
      const g = ctx.createGain();
      this.env(g, t, 0.5, 0.008, 0.17);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.25);
      this.noise(t, 0.12, 'bandpass', 1400, 1.5, 0.18);
    }
  }

  /** A single wing beat. */
  flap(): void {
    if (!this.ctx) return;
    const f = this.noise(this.now, 0.16, 'lowpass', 900, 1, 0.22, 0.03);
    f.frequency.exponentialRampToValueAtTime(300, this.now + 0.18);
  }

  /** A scoop of earth. */
  dig(): void {
    if (!this.ctx) return;
    const t = this.now;
    this.noise(t, 0.12, 'lowpass', 500, 2, 0.35);
    this.noise(t + 0.06, 0.18, 'bandpass', 2400, 1, 0.08);
  }

  /** Thief yelps and scurries away. */
  flee(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(250, t + 0.5);
    const g = ctx.createGain();
    this.env(g, t, 0.06, 0.01, 0.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
    for (let i = 0; i < 6; i++) this.noise(t + 0.1 + i * 0.09, 0.05, 'bandpass', 3000, 3, 0.07);
  }

  /** Kitten mew: a sad falling glide, or a happy rising chirp. */
  mew(sad: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const [a, b, c] = sad ? [700, 950, 520] : [650, 1100, 1250];
    o.frequency.setValueAtTime(a, t);
    o.frequency.linearRampToValueAtTime(b, t + 0.12);
    o.frequency.linearRampToValueAtTime(c, t + 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    this.env(g, t, sad ? 0.12 : 0.15, 0.05, 0.42);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
  }

  /** Soft puff when the wrong creature appears and fades. */
  fizzle(): void {
    if (!this.ctx) return;
    this.tone(330, this.now, 0.35, 'sine', 0.1);
    this.tone(247, this.now + 0.15, 0.45, 'sine', 0.08);
  }

  /** Level solved: warm major cadence. */
  levelComplete(): void {
    if (!this.ctx) return;
    const t = this.now;
    const chords = [
      [392, 493.88, 587.33],
      [523.25, 659.25, 783.99],
    ];
    chords.forEach((c, i) => c.forEach((f) => this.tone(f, t + i * 0.35, 1.3, 'triangle', 0.09)));
  }

  /** Ending fanfare. */
  fanfare(): void {
    if (!this.ctx) return;
    const t = this.now;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone(f, t + i * 0.16, i === notes.length - 1 ? 2 : 0.4, 'triangle', 0.13));
    [261.63, 329.63, 392].forEach((f) => this.tone(f, t + 0.96, 2.2, 'sine', 0.08));
  }
}

export const sfx = new Sfx();
