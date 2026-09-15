import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Node 26's experimental store must not shadow jsdom's browser localStorage.
    execArgv: ['--no-experimental-webstorage'],
    include: ['tests/*.test.tsx'],
    setupFiles: ['tests/ui-setup.ts'],
  },
});
