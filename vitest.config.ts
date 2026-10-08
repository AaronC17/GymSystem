import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests must not load the application's production database credentials.
  envDir: false,
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    env: {
      MONGODB_URI: '',
      MONGODB_DB: 'kyon_test',
      SESSION_SECRET: 'test-only-session-secret-not-for-deployment',
      VERCEL_ENV: 'development',
    },
  },
});
