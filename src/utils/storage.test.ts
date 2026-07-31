import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadState, saveState, removeState, clearAllState, SCHEMA_VERSION } from './storage';

// Minimal in-memory Storage implementation so the layer can be exercised in Node.
class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const rawKey = (name: string) => `quoteforge:v${SCHEMA_VERSION}:${name}`;

describe('storage layer', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips structured values', () => {
    const value = [{ id: 'q1', total: 12.5 }];
    saveState('quotes', value);
    expect(loadState('quotes', [])).toEqual(value);
  });

  it('returns the seed when nothing is stored', () => {
    expect(loadState('missing', { seeded: true })).toEqual({ seeded: true });
  });

  it('falls back to the seed on corrupt JSON instead of throwing', () => {
    localStorage.setItem(rawKey('quotes'), '{ not valid json');
    expect(loadState('quotes', ['seed'])).toEqual(['seed']);
  });

  it('removes a single key', () => {
    saveState('parts', [1, 2, 3]);
    removeState('parts');
    expect(loadState('parts', null)).toBeNull();
  });

  it('clears only QuoteForge-namespaced keys', () => {
    saveState('quotes', [1]);
    saveState('settings', { a: 1 });
    localStorage.setItem('some-other-app', 'keep-me');

    clearAllState();

    expect(loadState('quotes', 'gone')).toBe('gone');
    expect(loadState('settings', 'gone')).toBe('gone');
    expect(localStorage.getItem('some-other-app')).toBe('keep-me');
  });

  it('degrades gracefully when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveState('quotes', [1])).not.toThrow();
    expect(loadState('quotes', 'seed')).toBe('seed');
  });
});
