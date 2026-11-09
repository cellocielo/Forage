import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The web app reuses the extension's screens and logic (practice, settings, saving). Two
// modules differ: the Supabase client (browser storage instead of extension storage) and the
// badge (the app icon instead of the toolbar).
const extension = fileURLToPath(new URL('../extension', import.meta.url));
const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Same project keys as the extension; set these in the host's environment for deploys.
  envDir: extension,
  envPrefix: 'WXT_',
  resolve: {
    alias: [
      { find: /^@\/lib\/supabase$/, replacement: `${src}/supabase.ts` },
      { find: /^@\/lib\/badge$/, replacement: `${src}/badge.ts` },
      { find: /^@\//, replacement: `${extension}/` },
    ],
    // Shared files sit next to the extension's node_modules; use one copy of each.
    dedupe: ['react', 'react-dom', '@supabase/supabase-js'],
  },
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'happy-dom',
    clearMocks: true,
    restoreMocks: true,
    env: {
      WXT_SUPABASE_URL: 'http://127.0.0.1:54321',
      WXT_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
