import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '../api/_lib/vercel';

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(),
  authenticateAccount: vi.fn(),
  authenticateUser: vi.fn(),
  lookupCredential: vi.fn(),
}));

vi.mock('../api/_lib/access.js', () => ({
  resolveLegacyAccount: vi.fn(),
  resolveRegisteredAccount: vi.fn(),
  resolveSessionAccess: vi.fn(),
  resolveAccountAccess: vi.fn(),
}));
vi.mock('../api/_lib/accounts.js', () => ({
  findAccount: mocks.findAccount,
  authenticateAccount: mocks.authenticateAccount,
}));
vi.mock('../api/_lib/users.js', () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock('../api/_lib/credentials.js', () => ({ lookupCredential: mocks.lookupCredential, verifyCredentialPassword: vi.fn() }));

import handler from '../api/session';

async function invoke(body: unknown) {
  const response = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string | number | readonly string[]>,
    status: vi.fn<(code: number) => VercelResponse>(),
    json: vi.fn<(value: unknown) => VercelResponse>(),
    setHeader: vi.fn<(name: string, value: string | number | readonly string[]) => VercelResponse>(),
  };
  const res = response as unknown as VercelResponse;
  response.status.mockImplementation((status) => { response.statusCode = status; return res; });
  response.json.mockImplementation((value) => { response.body = value; return res; });
  response.setHeader.mockImplementation((name, value) => { response.headers[name] = value; return res; });
  await handler({ method: 'POST', body, headers: { host: 'app.example.invalid' } } as unknown as VercelRequest, res);
  return response;
}

beforeEach(() => vi.resetAllMocks());

describe('session route input bounds before authentication', () => {
  it.each([
    { email: 'e'.repeat(255), password: 'synthetic-password' },
    { email: 'valid@example.invalid', password: 'x'.repeat(257) },
  ])('rejects oversized login input before looking up accounts', async (body) => {
    const response = await invoke(body);
    expect(response.statusCode).toBe(400);
    expect(mocks.findAccount).not.toHaveBeenCalled();
    expect(mocks.authenticateAccount).not.toHaveBeenCalled();
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it('keeps the existing legacy password maximum without performing real hashing', async () => {
    const syntheticAccount = { email: 'member@example.invalid', name: 'Fixture', salt: 'synthetic', hash: 'synthetic' };
    mocks.findAccount.mockReturnValue(syntheticAccount);
    mocks.authenticateAccount.mockResolvedValue(null);
    const response = await invoke({ email: syntheticAccount.email, password: 'x'.repeat(256) });
    expect(response.statusCode).toBe(401);
    expect(mocks.findAccount).toHaveBeenCalledOnce();
    expect(mocks.authenticateAccount).toHaveBeenCalledOnce();
    expect(mocks.authenticateAccount.mock.calls[0][1].length).toBe(256);
  });

  it('keeps registered-account policy at 128 characters without touching the database', async () => {
    mocks.findAccount.mockReturnValue(null);
    const response = await invoke({ email: 'member@example.invalid', password: 'x'.repeat(129) });
    expect(response.statusCode).toBe(401);
    expect(mocks.findAccount).toHaveBeenCalledOnce();
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before checking accounts', async () => {
    for (const body of [null, undefined, [], 1, '{}', '{']) {
      const response = await invoke(body);
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.findAccount).not.toHaveBeenCalled();
  });
});
