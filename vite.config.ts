import { execSync } from 'child_process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * WHICH CODE AM I RUNNING?
 *
 * package.json says 0.0.0 and always will, so it answers nothing. The commit is
 * the only thing that identifies a build, and a dirty working tree is worth
 * knowing about too — an uncommitted edit means the running app is not any
 * commit at all.
 *
 * Captured when the config loads, so a dev server shows the commit it STARTED
 * on: restart it after committing if you want the badge to move.
 *
 * Every call is guarded. A deployed container often has no .git and no git
 * binary, and a build must not fail for the sake of a label.
 */
function buildInfo() {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  return {
    sha: run('git rev-parse --short HEAD') || 'unknown',
    date: run('git log -1 --format=%cd --date=format:%Y-%m-%d') || '',
    dirty: run('git status --porcelain') !== '',
  };
}

export default defineConfig(({mode}) => {
  const build = buildInfo();
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __BUILD_SHA__: JSON.stringify(build.sha),
      __BUILD_DATE__: JSON.stringify(build.date),
      __BUILD_DIRTY__: JSON.stringify(build.dirty),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
