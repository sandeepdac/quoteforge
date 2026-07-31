/**
 * Typed, namespaced localStorage layer for QuoteForge.
 *
 * All app state is persisted under a versioned `quoteforge:vN:*` namespace so the
 * schema can be intentionally busted (bump SCHEMA_VERSION) without colliding with
 * other apps on the same origin. Every access is guarded: a missing key returns the
 * seed value, and corrupt or unavailable storage degrades to the seed instead of
 * throwing. This keeps the app usable in private-mode browsers, SSR, and tests.
 *
 * The API is deliberately backend-shaped (load/save/remove by logical name) so a
 * real persistence backend can be dropped in later without touching call sites.
 */

const NAMESPACE = 'quoteforge';
export const SCHEMA_VERSION = 1;

function storageKey(name: string): string {
  return `${NAMESPACE}:v${SCHEMA_VERSION}:${name}`;
}

/** Returns the localStorage implementation, or null when it is unavailable. */
function getStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw in sandboxed iframes / disabled-cookie modes.
    return null;
  }
}

/** Loads and parses a persisted value, falling back to `seed` on any failure. */
export function loadState<T>(name: string, seed: T): T {
  const store = getStore();
  if (!store) return seed;
  try {
    const raw = store.getItem(storageKey(name));
    if (raw === null) return seed;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[storage] could not load "${name}", using seed value`, err);
    return seed;
  }
}

/** Serializes and persists a value. Silently no-ops if storage is unavailable/full. */
export function saveState<T>(name: string, value: T): void {
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(storageKey(name), JSON.stringify(value));
  } catch (err) {
    // QuotaExceededError and similar — the app keeps working from in-memory state.
    console.warn(`[storage] could not save "${name}"`, err);
  }
}

/** Removes a single persisted key. */
export function removeState(name: string): void {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(storageKey(name));
  } catch (err) {
    console.warn(`[storage] could not remove "${name}"`, err);
  }
}

/** Clears every QuoteForge key across all schema versions (used by "reset demo data"). */
export function clearAllState(): void {
  const store = getStore();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith(`${NAMESPACE}:`)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch (err) {
    console.warn('[storage] could not clear state', err);
  }
}
