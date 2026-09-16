import { describe, it, expect } from 'vitest';
import { BUILD_SHA, BUILD_LABEL, BUILD_TITLE, BUILD_DIRTY } from './buildInfo';

/**
 * The badge exists to answer "am I running the right code?", so the one thing it
 * must never do is fail to render — including outside a Vite build, where the
 * injected globals do not exist at all. This file is itself that case: vitest
 * does not replace them, so importing the module here exercises the fallback.
 */
describe('the build badge always has something to say', () => {
  it('degrades instead of throwing when the globals were never injected', () => {
    expect(typeof BUILD_SHA).toBe('string');
    expect(BUILD_SHA.length).toBeGreaterThan(0);
    expect(typeof BUILD_DIRTY).toBe('boolean');
  });

  it('the label is short enough to sit beside a logo', () => {
    expect(BUILD_LABEL.length).toBeLessThanOrEqual(12);
  });

  it('the tooltip names the commit, which is what a bug report should quote', () => {
    expect(BUILD_TITLE).toContain('commit');
    expect(BUILD_TITLE).toContain(BUILD_SHA);
  });

  it('a dirty tree is marked, because then the build is not any commit', () => {
    // The label carries "+" only when the tree was dirty — the two must agree,
    // or the badge would claim a clean build that is not one.
    expect(BUILD_LABEL.endsWith('+')).toBe(BUILD_DIRTY);
  });
});
