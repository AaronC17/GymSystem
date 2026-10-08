import { createHmac, scryptSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '../api/_lib/vercel';

const fixtures = vi.hoisted(() => ({
  legacyEmail: 'legacy@example.invalid', registeredEmail: 'registered@example.invalid',
  oldPassword: 'Original-fixture123', salt: 'fixture-salt', hash: '',
  credentials: new Map<string, Record<string, unknown>>(),
  users: new Map<string, Record<string, unknown>>(),
  writes: vi.fn(), database: vi.fn(),
}));

vi.mock('../api/_lib/mongo.js', () => ({
  getDatabase: fixtures.database,
}));
vi.mock('../api/_lib/accounts.js', async () => {
  const { verifyAccountPassword } = await import('../api/_lib/password');
  const findAccount = (email: string) => email.trim().toLowerCase() === fixtures.legacyEmail
    ? { email: fixtures.legacyEmail, name: 'Legacy fixture', salt: fixtures.salt, hash: fixtures.hash } : null;
  return {
    findAccount,
    authenticateAccount: async (email: string, password: string) => {
      const account = findAccount(email);
      return account && await verifyAccountPassword(password, account.salt, account.hash) ? account : null;
    },
  };
});

import passwordHandler from '../api/password';
import sessionHandler from '../api/session';
import { createSession, readSession } from '../api/_lib/session';
import { resolveSessionAccess } from '../api/_lib/access';
import { lookupCredential, replaceCredential, verifyCredentialPassword } from '../api/_lib/credentials';

const newPassword = 'Replacement-fixture456';
type Options = { method?: string; cookie?: string; owner?: string | string[]; origin?: string; body?: unknown };
function request(options: Options = {}): VercelRequest {
  return {
    method: options.method ?? 'POST', body: options.body,
    headers: { host: 'app.example.invalid', origin: options.origin ?? 'https://app.example.invalid',
      cookie: options.cookie, 'x-kyon-user-email': options.owner },
  } as unknown as VercelRequest;
}
async function invoke(handler: typeof passwordHandler, options: Options = {}) {
  const response = {
    statusCode: 200, body: null as unknown, headers: {} as Record<string, string | number | readonly string[]>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string | number | readonly string[]) { this.headers[name] = value; return this; },
  };
  await handler(request(options), response as unknown as VercelResponse);
  return response;
}
function cookieFor(email: string, version?: string) {
  return `kyon-session=${createSession({ email, name: 'Fixture' }, false, version).token}`;
}
function changeOptions(email = fixtures.legacyEmail, version?: string): Options {
  return { cookie: cookieFor(email, version), owner: email, body: { currentPassword: fixtures.oldPassword, newPassword } };
}

beforeEach(() => {
  fixtures.hash = scryptSync(fixtures.oldPassword, fixtures.salt, 64).toString('hex');
  fixtures.credentials.clear();
  fixtures.users.clear();
  fixtures.writes.mockReset();
  fixtures.database.mockReset();
  const now = new Date();
  fixtures.users.set(fixtures.registeredEmail, {
    _id: fixtures.registeredEmail, name: 'Registered fixture', passwordSalt: fixtures.salt, passwordHash: fixtures.hash,
    createdAt: now, updatedAt: now, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 86400000),
    paidAt: null, paidAmountCrc: null, paidMethod: null, activatedBy: null,
  });
  fixtures.database.mockResolvedValue({
    collection(name: string) {
      if (!['users', 'accountCredentials'].includes(name)) throw new Error('Unexpected collection');
      const documents = name === 'users' ? fixtures.users : fixtures.credentials;
      return {
        async findOne(filter: { _id: string }) { return documents.get(filter._id) ? { ...documents.get(filter._id) } : null; },
        async insertOne(document: Record<string, unknown> & { _id: string }) {
          if (name !== 'accountCredentials') throw new Error('User writes forbidden');
          if (documents.has(document._id)) throw Object.assign(new Error('Fixture duplicate'), { code: 11000 });
          fixtures.writes(name, 'insert');
          documents.set(document._id, { ...document });
          return { acknowledged: true };
        },
        async updateOne(filter: { _id: string; version: string }, update: { $set: Record<string, unknown> }) {
          if (name !== 'accountCredentials') throw new Error('User writes forbidden');
          const previous = documents.get(filter._id);
          if (!previous || previous.version !== filter.version) return { matchedCount: 0 };
          fixtures.writes(name, 'update');
          documents.set(filter._id, { ...previous, ...update.$set });
          return { matchedCount: 1 };
        },
      };
    },
  });
});

describe('password change authentication and validation', () => {
  it('requires authentication, matching owner and same origin before any database use', async () => {
    const valid = changeOptions();
    for (const [options, status] of [
      [{ ...valid, cookie: undefined }, 401],
      [{ ...valid, cookie: 'kyon-session=invalid' }, 401],
      [{ ...valid, owner: undefined }, 403],
      [{ ...valid, owner: 'someone@example.invalid' }, 403],
      [{ ...valid, owner: [fixtures.legacyEmail] }, 403],
      [{ ...valid, origin: 'https://evil.example.invalid' }, 403],
    ] as [Options, number][]) {
      expect((await invoke(passwordHandler, options)).statusCode).toBe(status);
    }
    expect(fixtures.database).not.toHaveBeenCalled();
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it.each([
    null, [], '{', {}, { currentPassword: 1, newPassword },
    { currentPassword: '', newPassword }, { currentPassword: 'x'.repeat(257), newPassword },
    ...['short1', 'abcdefgh', '12345678', 'x1'.repeat(65)].map((value) => ({ currentPassword: fixtures.oldPassword, newPassword: value })),
  ])('rejects invalid body without hashing or writing', async (body) => {
    expect((await invoke(passwordHandler, { ...changeOptions(), body })).statusCode).toBe(400);
    expect(fixtures.database).not.toHaveBeenCalled();
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('rejects the wrong current password without changing anything', async () => {
    const result = await invoke(passwordHandler, { ...changeOptions(), body: { currentPassword: 'Wrong-fixture123', newPassword } });
    expect(result.statusCode).toBe(401);
    expect(fixtures.writes).not.toHaveBeenCalled();
    expect(fixtures.credentials.size).toBe(0);
  });

  it('only allows POST', async () => {
    const response = await invoke(passwordHandler, { ...changeOptions(), method: 'GET' });
    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('POST');
    expect(fixtures.database).not.toHaveBeenCalled();
  });
});

describe('authoritative password overrides and session revocation', () => {
  it.each([fixtures.legacyEmail, fixtures.registeredEmail])('changes %s without modifying account metadata', async (email) => {
    const userBefore = structuredClone(fixtures.users.get(fixtures.registeredEmail));
    const oldCookie = cookieFor(email);
    expect(await resolveSessionAccess(request({ cookie: oldCookie }))).not.toBeNull();
    const response = await invoke(passwordHandler, { ...changeOptions(email), owner: ` ${email.toUpperCase()} ` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(response.headers['Cache-Control']).toContain('no-store');
    expect(fixtures.users.get(fixtures.registeredEmail)).toEqual(userBefore);
    expect(fixtures.writes).toHaveBeenCalledExactlyOnceWith('accountCredentials', 'insert');
    const credential = await lookupCredential(email);
    expect(credential?.version).toMatch(/^[a-f\d]{32}$/);
    expect(await verifyCredentialPassword(email, newPassword, credential)).toBe(true);
    expect(await resolveSessionAccess(request({ cookie: oldCookie }))).toBeNull();
    expect((await invoke(sessionHandler, { method: 'GET', cookie: oldCookie })).statusCode).toBe(401);
    expect((await invoke(sessionHandler, { body: { email, password: fixtures.oldPassword } })).statusCode).toBe(401);
    const login = await invoke(sessionHandler, { body: { email, password: newPassword, remember: true } });
    expect(login.statusCode).toBe(200);
    const newCookie = String(login.headers['Set-Cookie']).split(';')[0];
    expect(readSession(request({ cookie: newCookie }))?.credentialVersion).toBe(credential?.version);
    expect(await resolveSessionAccess(request({ cookie: newCookie }))).not.toBeNull();
    expect((await invoke(sessionHandler, { method: 'GET', cookie: newCookie })).statusCode).toBe(200);
    expect((await invoke(passwordHandler, { ...changeOptions(email), cookie: oldCookie })).statusCode).toBe(401);
    // A fresh session can rotate the override again; metadata still stays intact.
    const second = await invoke(passwordHandler, { cookie: newCookie, owner: email, body: { currentPassword: newPassword, newPassword: 'Third-fixture789' } });
    expect(second.statusCode).toBe(200);
    expect(await resolveSessionAccess(request({ cookie: newCookie }))).toBeNull();
    expect(fixtures.users.get(fixtures.registeredEmail)).toEqual(userBefore);
  });

  it('continues to support original logins without automatically creating overrides', async () => {
    for (const email of [fixtures.legacyEmail, fixtures.registeredEmail]) {
      const login = await invoke(sessionHandler, { body: { email, password: fixtures.oldPassword } });
      expect(login.statusCode).toBe(200);
      expect(readSession(request({ cookie: String(login.headers['Set-Cookie']).split(';')[0] }))).toEqual({ email });
    }
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed authoritative override instead of using the original password', async () => {
    fixtures.credentials.set(fixtures.legacyEmail, { _id: fixtures.legacyEmail, passwordHash: 'invalid', passwordSalt: 'invalid', version: 'a'.repeat(32) });
    expect((await invoke(sessionHandler, { body: { email: fixtures.legacyEmail, password: fixtures.oldPassword } })).statusCode).toBe(401);
  });

  it('never accepts an unversioned session against an override with a missing version', async () => {
    fixtures.credentials.set(fixtures.legacyEmail, { _id: fixtures.legacyEmail, passwordHash: fixtures.hash, passwordSalt: fixtures.salt });
    expect(await resolveSessionAccess(request({ cookie: cookieFor(fixtures.legacyEmail) }))).toBeNull();
    expect((await invoke(passwordHandler, changeOptions())).statusCode).toBe(401);
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('does not revoke other accounts or rotate the signing secret', async () => {
    const secret = process.env.SESSION_SECRET;
    const otherCookie = cookieFor(fixtures.registeredEmail);
    await invoke(passwordHandler, changeOptions());
    expect(process.env.SESSION_SECRET).toBe(secret);
    expect(await resolveSessionAccess(request({ cookie: otherCookie }))).not.toBeNull();
  });

  it.each(['expired', 'paid'])('preserves %s registered access and payment metadata', async (state) => {
    const document = fixtures.users.get(fixtures.registeredEmail)!;
    document.trialEndsAt = new Date(Date.now() - 86400000);
    if (state === 'paid') {
      document.paidAt = new Date();
      document.paidAmountCrc = 5000;
      document.paidMethod = 'SINPE';
      document.activatedBy = 'fixture-admin@example.invalid';
    }
    const before = structuredClone(document);
    expect((await invoke(passwordHandler, changeOptions(fixtures.registeredEmail))).statusCode).toBe(200);
    const credential = await lookupCredential(fixtures.registeredEmail);
    const access = await resolveSessionAccess(request({ cookie: cookieFor(fixtures.registeredEmail, credential!.version) }));
    expect(access?.access.status).toBe(state === 'paid' ? 'active' : 'expired');
    expect(fixtures.users.get(fixtures.registeredEmail)).toEqual(before);
  });

  it('cannot write credentials for an unknown session identity', async () => {
    expect((await invoke(passwordHandler, changeOptions('missing@example.invalid'))).statusCode).toBe(401);
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('rejects a versioned session if its override is absent', async () => {
    expect(await resolveSessionAccess(request({ cookie: cookieFor(fixtures.legacyEmail, 'a'.repeat(32)) }))).toBeNull();
  });

  it('allows exactly one simultaneous first change', async () => {
    const responses = await Promise.all([
      invoke(passwordHandler, changeOptions()),
      invoke(passwordHandler, { ...changeOptions(), body: { currentPassword: fixtures.oldPassword, newPassword: 'Competing-fixture789' } }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(fixtures.writes).toHaveBeenCalledOnce();
  });

  it('uses compare-and-swap for simultaneous subsequent changes', async () => {
    expect(await replaceCredential(fixtures.legacyEmail, newPassword, null)).toBe(true);
    const previous = await lookupCredential(fixtures.legacyEmail);
    fixtures.writes.mockClear();
    const outcomes = await Promise.all([
      replaceCredential(fixtures.legacyEmail, 'Competing-fixture111', previous),
      replaceCredential(fixtures.legacyEmail, 'Competing-fixture222', previous),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(fixtures.writes).toHaveBeenCalledOnce();
    expect((await lookupCredential(fixtures.legacyEmail))?.createdAt).toEqual(previous?.createdAt);
  });

  it('allows exactly one simultaneous subsequent API change', async () => {
    await replaceCredential(fixtures.legacyEmail, newPassword, null);
    const credential = await lookupCredential(fixtures.legacyEmail);
    fixtures.writes.mockClear();
    const options = { cookie: cookieFor(fixtures.legacyEmail, credential!.version), owner: fixtures.legacyEmail };
    const responses = await Promise.all([
      invoke(passwordHandler, { ...options, body: { currentPassword: newPassword, newPassword: 'Concurrent-fixture111' } }),
      invoke(passwordHandler, { ...options, body: { currentPassword: newPassword, newPassword: 'Concurrent-fixture222' } }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(fixtures.writes).toHaveBeenCalledOnce();
  });

  it('rejects invalid signed credential versions and validates createSession input', () => {
    expect(() => createSession({ email: fixtures.legacyEmail, name: 'Fixture' }, false, 'bad')).toThrow('Invalid credential version');
    for (const credentialVersion of [null, 1, '', 'bad', 'a'.repeat(33)]) {
      const encoded = Buffer.from(JSON.stringify({ email: fixtures.legacyEmail, exp: Date.now() / 1000 + 100, credentialVersion })).toString('base64url');
      const signature = createHmac('sha256', process.env.SESSION_SECRET!).update(encoded).digest('base64url');
      expect(readSession(request({ cookie: `kyon-session=${encoded}.${signature}` }))).toBeNull();
    }
  });

  it('does not log passwords, tokens, hashes or upstream error details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixtures.database.mockRejectedValue(new Error(`Sensitive fixture ${newPassword} ${fixtures.hash}`));
    expect((await invoke(passwordHandler, changeOptions())).statusCode).toBe(500);
    expect((await invoke(sessionHandler, { body: { email: fixtures.legacyEmail, password: fixtures.oldPassword } })).statusCode).toBe(500);
    expect(log.mock.calls).toEqual([['Password API error'], ['Session API error']]);
    expect(fixtures.writes).not.toHaveBeenCalled();
  });
});
