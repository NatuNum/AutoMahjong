/**
 * Deterministic Mulberry32 PRNG with explicit serializable 32-bit state.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  nextUint32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  /** Returns float in [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Returns integer in [0, maxExclusive) */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /** In-place Fisher-Yates shuffle */
  shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

/** Mixes a base seed with round & retry counter so retries produce fresh shuffles */
export function deriveRetrySeed(baseSeed: number, round: number, retryCount: number): number {
  let h = (baseSeed ^ Math.imul(round, 0x9e3779b1) ^ Math.imul(retryCount + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
