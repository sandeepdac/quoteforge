import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { loadState, saveState } from '../utils/storage';

/**
 * Drop-in replacement for useState that transparently persists to localStorage
 * under the given logical `name`. The initial render seeds from storage (or the
 * provided initial value on first run), and every subsequent change is written back.
 *
 * Writes are skipped on the initial mount so seeding never rewrites identical data.
 */
export function usePersistentState<T>(
  name: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    const seed = typeof initial === 'function' ? (initial as () => T)() : initial;
    return loadState<T>(name, seed);
  });

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveState(name, state);
  }, [name, state]);

  return [state, setState];
}
