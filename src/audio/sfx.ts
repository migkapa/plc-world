/**
 * Synthesized sound effects (WebAudio, no audio files).
 *
 *   sfx.play('click')             one-shot effects
 *   sfx.setLoop('motor', 0.7)     continuous sounds with an intensity 0..1 (0 = off)
 *   sfx.setEnabled(false)         global mute (persisted by the settings store)
 *
 * The AudioContext is created lazily on the first user gesture (browser autoplay policy).
 */

export type SfxName =
  | 'click'
  | 'press'
  | 'release'
  | 'toggle'
  | 'contactor'
  | 'pneumatic'
  | 'success'
  | 'fail'
  | 'levelUp'
  | 'xp'
  | 'star'
  | 'achievement'
  | 'fault'
  | 'beep';

export type LoopName = 'motor' | 'conveyor' | 'horn' | 'buzzer' | 'pump';

interface LoopVoice {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  target: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.5;
  private loops = new Map<LoopName, LoopVoice>();
  private noiseBuffer: AudioBuffer | null = null;

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
    if (!on) for (const name of this.loops.keys()) this.setLoop(name, 0);
  }

  isEnabled() {
    return this.enabled;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  /** Ensure the audio context exists and is running; returns null in non-browser environments. */
  private ensure(): AudioContext | null {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private burst(dur: number, opts: { gain?: number; freq?: number; q?: number; delay?: number; type?: BiquadFilterType } = {}) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.value = opts.freq ?? 2000;
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  play(name: SfxName) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    switch (name) {
      case 'click':
        this.burst(0.03, { freq: 4000, q: 2, gain: 0.25 });
        break;
      case 'press':
        this.burst(0.04, { freq: 2500, q: 3, gain: 0.35 });
        this.tone(180, 0.05, { type: 'square', gain: 0.05 });
        break;
      case 'release':
        this.burst(0.03, { freq: 3200, q: 3, gain: 0.25 });
        break;
      case 'toggle':
        this.burst(0.05, { freq: 1800, q: 4, gain: 0.45 });
        this.tone(120, 0.04, { type: 'triangle', gain: 0.1 });
        break;
      case 'contactor':
        this.burst(0.09, { freq: 900, q: 0.8, gain: 0.6 });
        this.tone(60, 0.12, { type: 'square', gain: 0.12 });
        break;
      case 'pneumatic':
        this.burst(0.35, { freq: 5000, q: 0.5, gain: 0.25, type: 'highpass' });
        break;
      case 'success':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.22, delay: i * 0.09 }));
        break;
      case 'fail':
        this.tone(220, 0.22, { type: 'sawtooth', gain: 0.12 });
        this.tone(160, 0.3, { type: 'sawtooth', gain: 0.12, delay: 0.16 });
        break;
      case 'levelUp':
        [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.2, delay: i * 0.07 }));
        this.tone(1568, 0.6, { type: 'sine', gain: 0.15, delay: 0.45 });
        break;
      case 'xp':
        this.tone(880, 0.08, { type: 'sine', gain: 0.12, slideTo: 1320 });
        break;
      case 'star':
        this.tone(1318.5, 0.18, { type: 'triangle', gain: 0.2 });
        this.tone(1760, 0.3, { type: 'sine', gain: 0.12, delay: 0.06 });
        break;
      case 'achievement':
        [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this.tone(f, 0.35, { type: 'square', gain: 0.07, delay: i * 0.1 }));
        break;
      case 'fault':
        [0, 0.25, 0.5].forEach((d) => this.tone(740, 0.15, { type: 'square', gain: 0.1, delay: d }));
        break;
      case 'beep':
        this.tone(1200, 0.08, { type: 'square', gain: 0.06 });
        break;
    }
  }

  /** Set a continuous sound's intensity (0 stops it). Cheap to call every frame. */
  setLoop(name: LoopName, intensity: number) {
    const on = this.enabled && intensity > 0.001;
    let voice = this.loops.get(name);
    if (!on) {
      if (voice && this.ctx) {
        voice.target = 0;
        voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!voice) {
      voice = this.createLoop(ctx, name);
      this.loops.set(name, voice);
    }
    const level = Math.min(1, intensity) * LOOP_LEVEL[name];
    if (Math.abs(level - voice.target) > 0.005) {
      voice.target = level;
      voice.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.12);
    }
  }

  private createLoop(ctx: AudioContext, name: LoopName): LoopVoice {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const nodes: AudioScheduledSourceNode[] = [];
    const osc = (type: OscillatorType, freq: number, g: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(gain);
      o.start();
      nodes.push(o);
      return o;
    };
    const noise = (freq: number, q: number, g: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const ng = ctx.createGain();
      ng.gain.value = g;
      src.connect(f).connect(ng).connect(gain);
      src.start();
      nodes.push(src);
    };
    switch (name) {
      case 'motor':
        osc('sawtooth', 120, 0.25); // 2x line frequency magnetic hum
        osc('sine', 240, 0.15);
        noise(700, 0.7, 0.4);
        break;
      case 'conveyor':
        noise(300, 0.5, 0.7);
        osc('triangle', 58, 0.2);
        break;
      case 'pump':
        noise(450, 1.2, 0.6);
        osc('sine', 90, 0.2);
        break;
      case 'horn': {
        osc('square', 420, 0.35);
        osc('square', 426, 0.25);
        break;
      }
      case 'buzzer':
        osc('square', 2800, 0.12);
        break;
    }
    return { gain, nodes, target: 0 };
  }

  /** Stop all loops (e.g. when leaving a scene). */
  stopAll() {
    for (const name of this.loops.keys()) this.setLoop(name, 0);
  }
}

const LOOP_LEVEL: Record<LoopName, number> = { motor: 0.12, conveyor: 0.1, pump: 0.1, horn: 0.12, buzzer: 0.06 };

/** Global sound effects singleton. */
export const sfx = new Sfx();
