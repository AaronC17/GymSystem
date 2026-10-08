import type { AccessInfo, AuthUser, AppState } from './types';
import { normalizeUserEmail } from './syncSession';
import { readProjectedSyncState } from './syncState';
import { readStoredState } from './data';

export const SESSION_PREVIEW_KEY = 'kyon-session-preview-v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
export type SessionPreview = { user: AuthUser; access: AccessInfo; state: AppState | null };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// A display hint, never an authentication token. It lives only in this tab and
// cannot enable sync, account changes or protected requests before server auth.
export function readSessionPreview(): SessionPreview | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SESSION_PREVIEW_KEY) ?? 'null');
    if (!record(value) || !record(value.user) || !record(value.access) || typeof value.savedAt !== 'number' || value.savedAt > Date.now() || Date.now() - value.savedAt > MAX_AGE_MS ||
      typeof value.user.email !== 'string' || !value.user.email.trim() || value.user.email.length > 254 || typeof value.user.name !== 'string' || !value.user.name.trim() || value.user.name.length > 200 ||
      !['active', 'trial', 'expired'].includes(String(value.access.status)) || !(value.access.trialEndsAt === null || typeof value.access.trialEndsAt === 'string' && Number.isFinite(Date.parse(value.access.trialEndsAt))) ||
      !Number.isSafeInteger(value.access.trialDaysRemaining) || Number(value.access.trialDaysRemaining) < 0 || typeof value.access.isAdmin !== 'boolean') return null;
    const user = { email: normalizeUserEmail(value.user.email), name: value.user.name };
    const access: AccessInfo = { ...(value.access as AccessInfo), isAdmin: false };
    if (access.status === 'trial' && access.trialEndsAt && Date.parse(access.trialEndsAt) <= Date.now()) { access.status = 'expired'; access.trialDaysRemaining = 0; }
    let state: AppState | null = null;
    try { state = readProjectedSyncState(localStorage, user.email); } catch { /* Never overwrite invalid outbox. */ }
    state ??= readStoredState(`kyon-state-cache-v1:${user.email}`);
    return { user, access, state };
  } catch { return null; }
}

export function saveSessionPreview(user: AuthUser, access: AccessInfo) {
  try { sessionStorage.setItem(SESSION_PREVIEW_KEY, JSON.stringify({ user, access, savedAt: Date.now() })); } catch { /* Optional acceleration. */ }
}
export function clearSessionPreview() {
  try { sessionStorage.removeItem(SESSION_PREVIEW_KEY); } catch { /* Session clearing must continue. */ }
}
