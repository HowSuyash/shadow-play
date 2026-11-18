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

  /** 0..1 master volume (Settings). */
  volume = 1;

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(0.8 * v, this.ctx.currentTime, 0.05);
  }

  /** Must be called from (or after) a user gesture: click, key, or XR session start. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8 * this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startAmbience();
    this.setWorld(this.world);
  }

  private get now(): number {
    return this.ctx!.currentTime;
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, release: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, peak: number, dest: AudioNode = this.dst): void {
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
    src.connect(f).connect(g).connect(this.dst);
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

  private drone: GainNode | undefined;
  private wind: GainNode | undefined;
  private windFilter: BiquadFilterNode | undefined;
  private world = 'theatre';

  // -------------------------------------------------------------------------
  // Music: a generative song per world, scheduled ahead on the audio clock.

  private musicBus: GainNode | undefined;
  private musicTimer: ReturnType<typeof setInterval> | undefined;
  private nextStep = 0;
  private musicStep = 0;
  /** 0 = calm, 1 = battle, 2 = boss battle: adds war drums to the song. */
  private battle = 0;
  private melodyIdx = 3;

  /** Per-world song: tempo, scale (semitones), root, lead voice, rhythm. */
  private static readonly SONGS: Record<string, { bpm: number; root: number; scale: number[]; lead: string; perc: string; bass: boolean; density: number }> = {
    // Raga-flavoured (Bhairav-like) melody on a sitar pluck over tabla bols.
    theatre: { bpm: 76, root: 261.63, scale: [0, 1, 4, 5, 7, 8, 11, 12], lead: 'sitar', perc: 'D.n.Dnn.D.n.dnn.', bass: false, density: 0.55 },
    // Bright lydian bells and arpeggios above the clouds.
    sky: { bpm: 84, root: 293.66, scale: [0, 2, 4, 6, 7, 9, 11, 12], lead: 'bell', perc: '..k...k...k...k.', bass: true, density: 0.7 },
    // A mysterious dorian flute with soft plucked bass.
    forest: { bpm: 62, root: 220, scale: [0, 2, 3, 5, 7, 9, 10, 12], lead: 'flute', perc: 'k.......k...k...', bass: true, density: 0.35 },
    // Dark harmonic-minor organ and a tolling bell.
    castle: { bpm: 54, root: 196, scale: [0, 2, 3, 5, 7, 8, 11, 12], lead: 'organ', perc: 'B...............', bass: true, density: 0.3 },
    // Boss battle: taiko drums and a driving minor ostinato.
    realm: { bpm: 104, root: 146.83, scale: [0, 2, 3, 5, 7, 8, 10, 12], lead: 'saw', perc: 'T.t.T.ttT.t.TTt.', bass: true, density: 0.6 },
  };

  private startMusic(): void {
    if (!this.ctx || this.musicTimer) return;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.nextStep = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
  }

  private scheduleMusic(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const song = Sfx.SONGS[this.world] ?? Sfx.SONGS.theatre;
    const stepDur = 60 / song.bpm / 2; // 8th notes
    while (this.nextStep < this.ctx.currentTime + 0.25) {
      this.playStep(song, this.musicStep, this.nextStep, stepDur);
      this.musicStep++;
      this.nextStep += stepDur;
    }
  }

  private freq(song: { root: number; scale: number[] }, idx: number): number {
    const n = song.scale.length - 1;
    const oct = Math.floor(idx / n);
    const deg = ((idx % n) + n) % n;
    return song.root * Math.pow(2, (song.scale[deg] + 12 * oct) / 12);
  }

  private playStep(song: (typeof Sfx.SONGS)[string], step: number, t: number, dur: number): void {
    const bus = this.musicBus!;
    const p = song.perc[step % song.perc.length];
    // Battle: war drums and a low pulse on top of the world's song.
    if (this.battle > 0) {
      const war = this.battle > 1 ? 'T.tTT.t.T.tTT.tt' : 'T...t.T.T...t.t.';
      const w = war[step % 16];
      if (w === 'T') this.drum(t, 85, 36, 0.7, 0.42);
      if (w === 't') this.drum(t, 130, 62, 0.3, 0.22);
      if (step % 4 === 2) this.hit(t, 7000, 1, 0.04, 0.035);
      if (step % 2 === 0) this.voice('sawbass', this.freq(song, step % 16 < 8 ? 0 : -3) / 2, t, dur * 1.2, 0.07, bus);
    }
    if (p === 'D') this.drum(t, 110, 55, 0.5, 0.35); // tabla "dha"
    if (p === 'd') this.drum(t, 150, 90, 0.25, 0.2);
    if (p === 'n') this.hit(t, 2600, 6, 0.12, 0.08); // tabla "na"
    if (p === 'k') this.hit(t, 6000, 1, 0.05, 0.05);
    if (p === 'T') this.drum(t, 90, 38, 0.8, 0.6); // taiko
    if (p === 't') this.drum(t, 140, 70, 0.35, 0.25);
    if (p === 'B' && step % 32 === 0) this.bell(t, song.root / 2, 0.18, 4);
    // Bass on the downbeat of each bar.
    if (song.bass && step % 8 === 0) {
      const f = this.freq(song, step % 32 < 16 ? 0 : 4) / 2;
      this.voice(song.lead === 'saw' ? 'sawbass' : 'bass', f, t, dur * 7, 0.18, bus);
    }
    if (song.lead === 'saw' && step % 2 === 0) {
      // Boss ostinato: a driving 1-1-5-b6 figure.
      const fig = [0, 0, 4, 5, 0, 0, 4, 3];
      this.voice('saw', this.freq(song, fig[(step / 2) % 8]), t, dur * 1.6, 0.07, bus);
    }
    // Lead melody: a gentle random walk on the scale.
    const strong = step % 2 === 0;
    if (Math.random() < song.density * (strong ? 1 : 0.4)) {
      this.melodyIdx += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
      this.melodyIdx = Math.max(0, Math.min(12, this.melodyIdx));
      const len = song.lead === 'flute' || song.lead === 'organ' ? dur * 3.5 : dur * 2.2;
      this.voice(song.lead, this.freq(song, this.melodyIdx), t, len, song.lead === 'organ' ? 0.07 : 0.11, bus);
    }
    // Pads: a soft chord every two bars (sky, castle, forest).
    if ((song.lead === 'bell' || song.lead === 'organ' || song.lead === 'flute') && step % 16 === 0) {
      for (const d of [0, 2, 4]) this.voice('pad', this.freq(song, d + (step % 32 === 0 ? 0 : 3)), t, dur * 15, 0.035, bus);
    }
  }

  private voice(kind: string, f: number, t: number, dur: number, peak: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(dest);
    const osc = (type: OscillatorType, freq: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.start(t);
      o.stop(t + dur + 0.6);
      return o;
    };
    if (kind === 'sitar') {
      // Bright pluck with a twangy resonant filter sweep and a slight meend (bend).
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.Q.value = 6;
      f1.frequency.setValueAtTime(f * 6, t);
      f1.frequency.exponentialRampToValueAtTime(f * 2, t + 0.4);
      const o = osc('sawtooth', f);
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.08);
      o.connect(f1).connect(g);
      osc('triangle', f * 2, 4).connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    } else if (kind === 'flute') {
      const o = osc('sine', f);
      const lfo = osc('sine', 5);
      const lg = ctx.createGain();
      lg.gain.value = f * 0.012;
      lfo.connect(lg).connect(o.frequency);
      o.connect(g);
      this.noise(t, 0.08, 'bandpass', f * 3, 2, peak * 0.15, 0.03);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.12);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.15);
    } else if (kind === 'bell') {
      for (const [m, k] of [[1, 1], [2.76, 0.35], [5.4, 0.15]]) {
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(peak * k, t);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
        osc('sine', f * m).connect(pg).connect(dest);
      }
      return;
    } else if (kind === 'organ') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      osc('square', f).connect(lp);
      osc('square', f * 2, 6).connect(lp);
      osc('sine', f / 2).connect(lp);
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.15);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.25);
    } else if (kind === 'pad') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      osc('sawtooth', f, -7).connect(lp);
      osc('sawtooth', f, 7).connect(lp);
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.8);
      g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.5);
    } else {
      // bass, sawbass, saw
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'saw' ? 1800 : 500;
      osc(kind === 'bass' ? 'triangle' : 'sawtooth', f).connect(lp);
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
  }

  private drum(t: number, f0: number, f1: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    o.connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hit(t: number, f: number, q: number, dur: number, peak: number): void {
    this.noise(t, dur, 'bandpass', f, q, peak, 0.002);
  }

  private bell(t: number, f: number, peak: number, dur: number): void {
    this.voice('bell', f, t, dur, peak, this.musicBus!);
  }

  /** Creature movement: paw pads, rabbit hops, snake hiss, boots. */
  step(kind: 'paw' | 'hop' | 'hiss' | 'boot'): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.now;
    if (kind === 'paw') this.noise(t, 0.05, 'lowpass', 900, 1, 0.12);
    else if (kind === 'boot') this.noise(t, 0.07, 'lowpass', 500, 1, 0.16);
    else if (kind === 'hop') {
      this.noise(t, 0.07, 'lowpass', 400, 1, 0.18);
      this.tone(520, t, 0.08, 'sine', 0.04);
    } else this.noise(t, 0.35, 'highpass', 4500, 0.7, 0.07, 0.06);
  }

  /** Per-world soundscape: temple drone, forest crickets, castle depths, sky wind, realm pulse. */
  setWorld(world: string): void {
    this.world = world;
    if (!this.ctx) return;
    this.startMusic();
    const ctx = this.ctx;
    if (!this.drone) {
      // Tanpura-like drone: Sa and Pa with slow shimmering beats.
      this.drone = ctx.createGain();
      this.drone.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(this.drone).connect(this.master);
      for (const f of [130.81, 130.95, 196.0, 261.63]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = f > 200 ? 0.18 : 0.3;
        o.connect(g).connect(lp);
        o.start();
      }
      // Wind: looping filtered noise.
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.Q.value = 0.6;
      this.wind = ctx.createGain();
      this.wind.gain.value = 0;
      src.connect(this.windFilter).connect(this.wind).connect(this.master);
      src.start();
      const ambient = () => {
        if (!this.ctx) return;
        if (this.ctx.state === 'running') {
          if (this.world === 'forest') for (let k = 0; k < 3; k++) this.tone(4200 + Math.random() * 300, this.now + k * 0.07, 0.04, 'sine', 0.02);
          if (this.world === 'castle' && Math.random() < 0.5) this.tone(1800 + Math.random() * 600, this.now, 0.25, 'sine', 0.025);
          if (this.world === 'realm') this.tone(55, this.now, 1.6, 'sine', 0.12);
        }
        setTimeout(ambient, 900 + Math.random() * 1600);
      };
      setTimeout(ambient, 1200);
    }
    const t = ctx.currentTime;
    const preset: Record<string, [number, number, number]> = {
      // drone gain, wind gain, wind centre frequency
      theatre: [0.05, 0.0, 400],
      forest: [0.0, 0.05, 600],
      castle: [0.02, 0.06, 250],
      sky: [0.0, 0.1, 900],
      realm: [0.015, 0.07, 180],
    };
    const [d, w, f] = preset[world] ?? preset.theatre;
    this.drone.gain.setTargetAtTime(d, t, 1.2);
    this.wind!.gain.setTargetAtTime(w, t, 1.2);
    this.windFilter!.frequency.setTargetAtTime(f, t, 1.2);
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

  /** A musical note per creature (Shadow Memory), pentatonic so any order sounds good. */
  note(i: number): void {
    if (!this.ctx) return;
    const f = [392, 440, 523.25, 587.33, 659.25][i % 5];
    this.tone(f, this.now, 0.6, 'triangle', 0.15);
    this.tone(f * 2, this.now, 0.35, 'sine', 0.05);
  }

  /** Two quick bird chirps. */
  chirp(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 2; i++) {
      const t = this.now + i * 0.13;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2600, t);
      o.frequency.exponentialRampToValueAtTime(4200, t + 0.06);
      const g = this.ctx.createGain();
      this.env(g, t, 0.07, 0.005, 0.07);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** A warm, gentle bell — friendship. */
  charm(): void {
    if (!this.ctx) return;
    const t = this.now;
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this.tone(f, t + i * 0.12, 1.4, 'sine', 0.08));
  }

  /** Heavy stone/iron rumble: a gate grinding open. */
  rumble(seconds = 1.4): void {
    if (!this.ctx) return;
    const t = this.now;
    const f = this.noise(t, seconds, 'lowpass', 140, 3, 0.5, 0.15);
    f.frequency.linearRampToValueAtTime(260, t + seconds);
    for (let i = 0; i < 5; i++) this.noise(t + i * (seconds / 5), 0.05, 'bandpass', 900, 4, 0.12);
  }

  /** The Shadow Eater's growl. */
  roar(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(48, t + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    this.env(g, t, 0.35, 0.15, 1.1);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.4);
    this.noise(t, 1.0, 'bandpass', 300, 1, 0.2, 0.1);
  }

  /** A magic seal shattering: glassy sparkle with a deep thump. */
  sealBreak(): void {
    if (!this.ctx) return;
    const t = this.now;
    this.tone(90, t, 0.4, 'sine', 0.3);
    [1567.98, 2093, 2637, 3135.96].forEach((f, i) => this.tone(f, t + 0.03 * i, 0.6, 'triangle', 0.05));
    this.noise(t, 0.35, 'highpass', 5000, 0.8, 0.09);
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

  // -------------------------------------------------------------------------
  // Battle sounds

  /** Where one-shot sounds go: the master bus, or a stereo panner while `at()` runs. */
  private panNode: StereoPannerNode | undefined;
  private get dst(): AudioNode {
    return this.panNode ?? this.master;
  }

  /** Play the sounds made inside `fn` from a direction: -1 hard left … 1 hard right. */
  at(pan: number, fn: () => void): void {
    if (!this.ctx) return;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    this.panNode = p;
    try {
      fn();
    } finally {
      this.panNode = undefined;
    }
    // Let the panner be collected once its sounds have finished.
    setTimeout(() => p.disconnect(), 3000);
  }

  setBattle(level: 0 | 1 | 2): void {
    this.battle = level;
  }

  private get live(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** A blade or whip cutting the air; faster swings are brighter. */
  swoosh(intensity: number): void {
    if (!this.live) return;
    const t = this.now;
    const f = this.noise(t, 0.22, 'bandpass', 500 + intensity * 900, 1.4, 0.12 + intensity * 0.14, 0.04);
    f.frequency.exponentialRampToValueAtTime(1800 + intensity * 2600, t + 0.2);
  }

  /** Weapon connects with a monster. */
  impact(heavy: boolean): void {
    if (!this.live) return;
    const t = this.now;
    this.tone(heavy ? 70 : 110, t, heavy ? 0.35 : 0.2, 'sine', heavy ? 0.5 : 0.35);
    this.noise(t, heavy ? 0.18 : 0.1, 'lowpass', heavy ? 900 : 1600, 1, heavy ? 0.45 : 0.3);
    this.noise(t + 0.01, 0.06, 'highpass', 3500, 1, 0.12);
  }

  /** The serpent whip's crack. */
  crack(): void {
    if (!this.live) return;
    const t = this.now;
    this.noise(t, 0.03, 'highpass', 2500, 0.7, 0.55, 0.001);
    this.noise(t + 0.012, 0.09, 'bandpass', 1400, 2, 0.2, 0.002);
  }

  /** Something bounces off the Moon Shield. */
  clang(): void {
    if (!this.live) return;
    const t = this.now;
    [523, 1237, 1871, 2650].forEach((f, i) => this.tone(f, t, 0.9 - i * 0.15, 'sine', 0.09 - i * 0.015));
    this.noise(t, 0.05, 'highpass', 3000, 1, 0.2, 0.001);
  }

  /** A firebird leaves the hand. */
  throwFire(): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = this.now;
    const f = this.noise(t, 0.35, 'bandpass', 700, 2, 0.22, 0.02);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.3);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    this.env(g, t, 0.07, 0.01, 0.25);
    o.connect(g).connect(this.dst);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Firebird bursts into flame on impact. */
  burn(): void {
    if (!this.live) return;
    const t = this.now;
    this.noise(t, 0.45, 'lowpass', 1200, 0.8, 0.35, 0.005);
    this.tone(160, t, 0.3, 'sine', 0.25);
  }

  /** Imp screech: a nasty formant squeal. */
  screech(): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 500 + Math.random() * 300;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.7, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, 0.08, 0.03, 0.4);
    o.connect(bp).connect(g).connect(this.dst);
    o.start(t);
    o.stop(t + 0.5);
  }

  /** Brute growl. */
  growl(): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(70, t + 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    this.env(g, t, 0.22, 0.08, 0.8);
    o.connect(lp).connect(g).connect(this.dst);
    o.start(t);
    o.stop(t + 1);
    this.noise(t, 0.7, 'bandpass', 400, 2, 0.12, 0.08);
  }

  /** Heavy footstep. */
  stomp(): void {
    if (!this.live) return;
    const t = this.now;
    this.tone(55, t, 0.25, 'sine', 0.3);
    this.noise(t, 0.08, 'lowpass', 300, 1, 0.2);
  }

  /** A shadow orb gathering in a caster's hands. */
  castOrb(): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = this.now;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    g.connect(this.dst);
    for (const detune of [1, 1.015]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(200 * detune, t);
      o.frequency.exponentialRampToValueAtTime(700 * detune, t + 0.85);
      o.connect(g);
      o.start(t);
      o.stop(t + 1.05);
    }
  }

  /** Ground slam. */
  slam(): void {
    if (!this.live) return;
    const t = this.now;
    this.tone(45, t, 0.6, 'sine', 0.55);
    this.noise(t, 0.5, 'lowpass', 400, 1, 0.45, 0.003);
    this.noise(t + 0.02, 0.25, 'bandpass', 1200, 1, 0.15);
  }

  /** A monster bursts into shadow shards. */
  monsterDie(big: boolean): void {
    if (!this.live) return;
    const t = this.now;
    const f = this.noise(t, big ? 1.2 : 0.6, 'bandpass', big ? 900 : 1800, 1.5, big ? 0.4 : 0.25, 0.01);
    f.frequency.exponentialRampToValueAtTime(big ? 150 : 400, t + (big ? 1.1 : 0.55));
    [1046.5, 1318.5, 1568].forEach((fq, i) => this.tone(fq * (big ? 0.5 : 1), t + 0.05 + i * 0.05, 0.5, 'triangle', 0.05));
  }

  /** The player is hit. */
  hurt(): void {
    if (!this.live) return;
    const t = this.now;
    this.tone(80, t, 0.4, 'sine', 0.5);
    this.tone(160, t, 0.25, 'square', 0.06);
    this.noise(t, 0.3, 'lowpass', 600, 1, 0.3);
  }

  /** A shadow becomes a weapon in your hand. */
  summonWeapon(): void {
    if (!this.live) return;
    const t = this.now;
    const f = this.noise(t, 0.6, 'bandpass', 300, 3, 0.18, 0.2);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.55);
    [523.25, 783.99, 1046.5, 1567.98].forEach((fq, i) => this.tone(fq, t + 0.3 + i * 0.06, 0.8, 'triangle', 0.07));
    this.tone(130, t + 0.55, 0.5, 'sine', 0.3);
  }

  /** War horn: a wave begins. */
  horn(): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = this.now;
    const parts: [number, number][] = [
      [146.83, 0],
      [147.6, 0],
      [220, 0.02],
    ];
    for (const [f, d] of parts) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.94, t + d);
      o.frequency.linearRampToValueAtTime(f, t + d + 0.25);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.linearRampToValueAtTime(1300, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.2);
      g.gain.setValueAtTime(0.12, t + d + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.6);
      o.connect(lp).connect(g).connect(this.dst);
      o.start(t + d);
      o.stop(t + d + 1.7);
    }
  }

  /** A shadow rift tearing open. */
  riftOpen(): void {
    if (!this.live) return;
    const t = this.now;
    const f = this.noise(t, 0.8, 'bandpass', 2400, 2, 0.12, 0.15);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.8);
    this.tone(62, t, 0.8, 'sine', 0.15);
  }
}

export const sfx = new Sfx();
