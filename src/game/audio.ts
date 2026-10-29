/**
 * Effets sonores synthétisés à la volée avec Web Audio (aucun fichier audio).
 * Le contexte n'est créé qu'après une interaction utilisateur.
 */
export type Sfx =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'fireball'
  | 'explode'
  | 'nova'
  | 'whirl'
  | 'dash'
  | 'hurt'
  | 'death'
  | 'pickup'
  | 'gold'
  | 'levelup'
  | 'potion'
  | 'arrow'
  | 'slam'
  | 'portal'
  | 'error'
  | 'legendary'
  | 'break';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<Sfx, number>();
  volume = 0.6;
  muted = false;

  /** À appeler sur un geste utilisateur (clic sur « Nouvelle partie »). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolume();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(s: Sfx): void {
    if (!this.ctx || this.muted) return;
    // Anti-spam : un même son au plus toutes les 40 ms.
    const now = performance.now();
    if (now - (this.lastPlayed.get(s) ?? 0) < 40) return;
    this.lastPlayed.set(s, now);
    const v = 0.8 + Math.random() * 0.4;
    switch (s) {
      case 'swing':
        this.hiss(0.16, 0.35, 'bandpass', 2400 * v, 600, 0, 1.2);
        break;
      case 'hit':
        this.tone('square', 180 * v, 60, 0.09, 0.25);
        this.hiss(0.08, 0.3, 'lowpass', 2500, 400);
        break;
      case 'crit':
        this.tone('sawtooth', 320, 80, 0.14, 0.3);
        this.hiss(0.12, 0.4, 'highpass', 3000, 1200);
        break;
      case 'fireball':
        this.hiss(0.35, 0.3, 'bandpass', 600, 1800, 0, 0.8);
        this.tone('sine', 220, 440, 0.25, 0.1);
        break;
      case 'explode':
        this.hiss(0.5, 0.6, 'lowpass', 1600, 80);
        this.tone('sine', 120, 35, 0.4, 0.4);
        break;
      case 'nova':
        this.hiss(0.6, 0.35, 'highpass', 6000, 1500);
        this.tone('triangle', 1200, 300, 0.5, 0.15);
        break;
      case 'whirl':
        for (let i = 0; i < 3; i++) this.hiss(0.18, 0.28, 'bandpass', 1800, 500, i * 0.16, 1.4);
        break;
      case 'dash':
        this.hiss(0.2, 0.3, 'bandpass', 900, 2500, 0, 1);
        break;
      case 'hurt':
        this.tone('sawtooth', 160, 90, 0.18, 0.25);
        break;
      case 'death':
        this.tone('square', 300 * v, 70, 0.3, 0.15);
        this.hiss(0.25, 0.25, 'bandpass', 1200, 300, 0.02, 3);
        break;
      case 'pickup':
        this.tone('triangle', 660, 990, 0.1, 0.2);
        break;
      case 'gold':
        this.tone('triangle', 1400, 1800, 0.06, 0.15);
        this.tone('triangle', 2100, 2400, 0.08, 0.12, 0.05);
        break;
      case 'legendary':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.18, i * 0.07));
        break;
      case 'levelup':
        [392, 494, 587, 784].forEach((f, i) => this.tone('square', f, f * 1.01, 0.22, 0.12, i * 0.09));
        break;
      case 'potion':
        this.tone('sine', 300, 900, 0.3, 0.2);
        break;
      case 'arrow':
        this.hiss(0.12, 0.2, 'highpass', 4000, 2000);
        break;
      case 'slam':
        this.tone('sine', 90, 30, 0.5, 0.5);
        this.hiss(0.4, 0.5, 'lowpass', 900, 60);
        break;
      case 'portal':
        this.tone('sine', 200, 800, 0.8, 0.2);
        this.tone('sine', 300, 1200, 0.8, 0.12, 0.1);
        break;
      case 'break':
        this.hiss(0.22, 0.45, 'bandpass', 1800, 700, 0, 2);
        this.tone('triangle', 520 * v, 260, 0.12, 0.12);
        break;
      case 'error':
        this.tone('square', 140, 120, 0.12, 0.12);
        break;
    }
  }
}
