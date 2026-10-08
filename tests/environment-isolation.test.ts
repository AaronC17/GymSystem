import { describe, expect, it } from 'vitest';

describe('test environment isolation', () => {
  it('does not expose the application database connection to tests', () => {
    // Compare booleans so even a failing test cannot print real credentials.
    expect(process.env.MONGODB_URI === '').toBe(true);
    expect(process.env.MONGODB_DB === 'kyon_test').toBe(true);
  });

  it('uses only a test session secret', () => {
    expect(process.env.SESSION_SECRET === 'test-only-session-secret-not-for-deployment').toBe(true);
    expect(process.env.VERCEL_ENV === 'development').toBe(true);
  });
});
