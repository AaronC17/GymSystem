import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock('../api/_lib/password.js', () => ({ verifyAccountPassword: verifyMock }));

import { authenticateAccount } from '../api/_lib/accounts';

const email = 'contrerasaaron447@gmail.com';

beforeEach(() => { verifyMock.mockReset(); });

describe('asynchronous legacy account routing', () => {
  it('awaits verification and normalizes the account email', async () => {
    verifyMock.mockResolvedValue(true);
    const result = authenticateAccount(email.toUpperCase(), 'synthetic-password');
    expect(result).toBeInstanceOf(Promise);
    expect((await result)?.email).toBe(email);
    expect(verifyMock).toHaveBeenCalledOnce();
    expect(verifyMock.mock.calls[0][0]).toBe('synthetic-password');
    // Do not print or compare the real account's public hash/salt.
    expect(typeof verifyMock.mock.calls[0][1] === 'string').toBe(true);
    expect(typeof verifyMock.mock.calls[0][2] === 'string').toBe(true);
  });

  it('rejects a non-matching key', async () => {
    verifyMock.mockResolvedValue(false);
    expect(await authenticateAccount(email, 'synthetic-password')).toBeNull();
  });

  it('preserves early rejection of unknown accounts and oversized input', async () => {
    expect(await authenticateAccount('nobody@example.invalid', 'synthetic-password')).toBeNull();
    expect(await authenticateAccount(email, 'x'.repeat(257))).toBeNull();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('propagates derivation errors for the API caller to handle', async () => {
    verifyMock.mockRejectedValue(new Error('Synthetic crypto error'));
    await expect(authenticateAccount(email, 'synthetic-password')).rejects.toThrow('Synthetic crypto error');
  });
});
