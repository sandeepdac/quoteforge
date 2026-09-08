import { defineConfig } from 'vitest/config';

// Standalone Vitest config so tests don't pull in the Vite app plugins (React /
// Tailwind). The suite targets pure domain logic (pricing, STEP parsing, storage),
// which runs fine in a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
