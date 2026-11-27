/**
 * Procedural Web Audio API sound effects synthesizer.
 * Zero external audio assets; lazy AudioContext initialization on first user gesture.
 */
class ProceduralSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.14,
    delay = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playTilePlace(): void {
    this.tone(520, 260, 0.07, 'triangle', 0.15);
    this.tone(1100, 700, 0.035, 'sine', 0.08);
  }

  playTileDiscard(): void {
    this.tone(310, 140, 0.08, 'sine', 0.12);
  }

  playFuroCall(): void {
    this.tone(440, 660, 0.12, 'sawtooth', 0.1);
    this.tone(660, 880, 0.16, 'triangle', 0.14, 0.07);
  }

  playKanBoom(): void {
    this.tone(160, 55, 0.28, 'sawtooth', 0.2);
    this.tone(523, 784, 0.22, 'triangle', 0.14, 0.06);
  }

  playYakuLight(stepIndex: number): void {
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
    const base = scale[stepIndex % scale.length];
    this.tone(base, base * 1.02, 0.22, 'triangle', 0.14);
    this.tone(base * 1.5, base * 1.5, 0.18, 'sine', 0.07, 0.03);
  }

  playYakumanFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.tone(n, n, 0.35, 'sawtooth', 0.12, i * 0.08);
      this.tone(n * 0.5, n * 0.5, 0.4, 'triangle', 0.12, i * 0.08);
    });
  }

  playHit(isCrit = false): void {
    if (isCrit) {
      this.tone(720, 220, 0.1, 'sawtooth', 0.1);
    } else {
      this.tone(280, 120, 0.06, 'triangle', 0.06);
    }
  }

  playShopBuy(): void {
    this.tone(660, 880, 0.09, 'sine', 0.11);
    this.tone(880, 1320, 0.14, 'sine', 0.11, 0.07);
  }

  playVictory(): void {
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((n, i) => this.tone(n, n, 0.28, 'triangle', 0.13, i * 0.09));
  }

  playDefeat(): void {
    const notes = [392, 349.23, 311.13, 261.63];
    notes.forEach((n, i) => this.tone(n, n * 0.96, 0.24, 'sawtooth', 0.09, i * 0.11));
  }
}

export const soundEngine = new ProceduralSoundEngine();
