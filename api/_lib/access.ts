import type { AccessInfo, AuthUser } from '../../src/types.js';
import { findAccount } from './accounts.js';
import { readSession } from './session.js';
import type { VercelRequest } from './vercel.js';
import { lookupUser, normalizeEmail, type RegisteredUser } from './users.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ADMIN_EMAIL = 'contrerasaaron447@gmail.com';

export type AccountAccess = {
  user: AuthUser;
  access: AccessInfo;
};

function isAdmin(email: string) {
  return normalizeEmail(email) === ADMIN_EMAIL;
}

export function resolveLegacyAccount(account: { email: string; name: string }): AccountAccess {
  return {
    user: { email: account.email, name: account.name },
    access: {
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: 0,
      isAdmin: isAdmin(account.email),
    },
  };
}

export function resolveRegisteredAccount(account: RegisteredUser, now = new Date()): AccountAccess {
  const remainingMs = account.trialEndsAt.getTime() - now.getTime();
  const trialDaysRemaining = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const status = account.paidAt ? 'active' : remainingMs > 0 ? 'trial' : 'expired';
  return {
    user: { email: account.email, name: account.name },
    access: {
      status,
      trialEndsAt: account.trialEndsAt.toISOString(),
      trialDaysRemaining,
      isAdmin: isAdmin(account.email),
    },
  };
}

export async function resolveAccountAccess(email: string, now = new Date()): Promise<AccountAccess | null> {
  const legacyAccount = findAccount(email);
  if (legacyAccount) return resolveLegacyAccount(legacyAccount);
  const registeredAccount = await lookupUser(email);
  return registeredAccount ? resolveRegisteredAccount(registeredAccount, now) : null;
}

export async function resolveSessionAccess(req: VercelRequest, now = new Date()): Promise<AccountAccess | null> {
  const session = readSession(req);
  return session ? resolveAccountAccess(session.email, now) : null;
}
