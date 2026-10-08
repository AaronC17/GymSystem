import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAccountPassword } from '../api/_lib/password';

const salt = 'fixture-only-salt';
const password = 'fixture-only-password-123';
const hash = scryptSync(password, salt, 64).toString('hex');

describe('legacy cryptographic compatibility with entirely synthetic fixtures', () => {
  it('matches the previous Node scryptSync derivation using asynchronous scrypt', async () => {
    const result = verifyAccountPassword(password, salt, hash);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(true);
  });

  it('rejects an incorrect password and a different salt', async () => {
    expect(await verifyAccountPassword('different-fixture-password', salt, hash)).toBe(false);
    expect(await verifyAccountPassword(password, 'different-fixture-salt', hash)).toBe(false);
  });

  it('preserves Node hex decoding compatibility until legacy accounts are migrated', async () => {
    expect(await verifyAccountPassword(password, salt, hash + 'f')).toBe(true);
  });

  it('handles a synthetic 256-character password without changing derivation options', async () => {
    const longPassword = 'x'.repeat(256);
    const longHash = scryptSync(longPassword, salt, 64).toString('hex');
    expect(await verifyAccountPassword(longPassword, salt, longHash)).toBe(true);
  });
});
