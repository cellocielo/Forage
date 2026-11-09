import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
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
