import type { Seed } from "./types.js";

const UINT32_RANGE = 0x1_0000_0000;

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeSeed(seed: Seed): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new TypeError("A numeric seed must be finite.");
    }
    return Math.trunc(seed) >>> 0;
  }
  return hashString(seed);
}

/** A tiny, deterministic PRNG for reproducible local content generation. */
export class SeededRandom {
  private state: number;

  public constructor(seed: Seed) {
    this.state = normalizeSeed(seed);
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  public integer(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new TypeError("Random integer bounds must be integers.");
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError("Random integer maximum must be at least the minimum.");
    }
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  public chance(probability: number): boolean {
    if (probability < 0 || probability > 1 || !Number.isFinite(probability)) {
      throw new RangeError("Probability must be a finite number from zero to one.");
    }
    return this.next() < probability;
  }

  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("Cannot choose from an empty list.");
    }
    const item = items[this.integer(0, items.length - 1)];
    if (item === undefined) {
      throw new RangeError("Unable to choose a list item.");
    }
    return item;
  }

  public weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) {
      throw new RangeError("Cannot choose from an empty list.");
    }
    const weights = items.map((item) => Math.max(0, weight(item)));
    const total = weights.reduce((sum, current) => sum + current, 0);
    if (total <= 0) {
      return this.pick(items);
    }

    let cursor = this.next() * total;
    for (let index = 0; index < items.length; index += 1) {
      cursor -= weights[index] ?? 0;
      if (cursor <= 0) {
        const item = items[index];
        if (item !== undefined) {
          return item;
        }
      }
    }
    return items[items.length - 1] as T;
  }

  public shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.integer(0, index);
      const current = result[index];
      const swap = result[swapIndex];
      if (current !== undefined && swap !== undefined) {
        result[index] = swap;
        result[swapIndex] = current;
      }
    }
    return result;
  }

  public fork(label: string): SeededRandom {
    return new SeededRandom(`${this.state}:${label}:${this.next()}`);
  }
}

export function createSeededRandom(seed: Seed): SeededRandom {
  return new SeededRandom(seed);
}
