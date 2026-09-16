/**
 * The identity of the running build, injected by vite.config.ts.
 *
 * Exists so "am I looking at the right code?" has an answer on screen rather
 * than in a terminal. The commit is the answer; package.json's version is 0.0.0
 * and says nothing.
 *
 * The declares are guarded with typeof because these globals are replaced at
 * BUILD time — anything that imports this outside a Vite build (a vitest run, a
 * node script) would otherwise throw a ReferenceError rather than degrade.
 */
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;
declare const __BUILD_DIRTY__: boolean;

const read = <T>(get: () => T, fallback: T): T => {
  try {
    return get();
  } catch {
    return fallback;
  }
};

export const BUILD_SHA = read(() => __BUILD_SHA__, 'dev');
export const BUILD_DATE = read(() => __BUILD_DATE__, '');
export const BUILD_DIRTY = read(() => __BUILD_DIRTY__, false);

/** Short label for the sidebar: the commit, marked when the tree was dirty. */
export const BUILD_LABEL = `${BUILD_SHA}${BUILD_DIRTY ? '+' : ''}`;

/** The long form, for a tooltip — what a bug report should quote. */
export const BUILD_TITLE = [
  `commit ${BUILD_SHA}`,
  BUILD_DATE ? `committed ${BUILD_DATE}` : '',
  BUILD_DIRTY ? 'WITH UNCOMMITTED CHANGES — this build is not any commit' : '',
].filter(Boolean).join(' · ');
