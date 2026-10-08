import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearSessionPreview, readSessionPreview, saveSessionPreview, SESSION_PREVIEW_KEY } from '../src/sessionPreview';
import { createInitialState } from '../src/data';
import { syncOutboxKey } from '../src/syncState';
const user = { email: 'preview@example.invalid', name: 'Synthetic' };
const access = { status: 'active' as const, trialEndsAt: null, trialDaysRemaining: 0, isAdmin: true };
function memory() { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); vi.stubGlobal('sessionStorage', memory()); vi.stubGlobal('localStorage', memory()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('stores a tab-scoped display hint without tokens and never previews the admin role', () => {
  saveSessionPreview(user, access);
  expect(readSessionPreview()?.access.isAdmin).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(SESSION_PREVIEW_KEY)!)).toEqual({ user, access, savedAt: Date.now() });
  clearSessionPreview(); expect(readSessionPreview()).toBeNull();
});
it('replays the owner outbox in a read-only preview, without losing pending work', () => {
  saveSessionPreview(user, access);
  const raw = JSON.stringify({ version: 1, userEmail: user.email, baseState: createInitialState(), revision: 1, pending: [{ id: 'pending-unit-1234', type: 'setUnit', unit: 'lb' }] });
  localStorage.setItem(syncOutboxKey(user.email), raw);
  expect(readSessionPreview()?.state?.unit).toBe('lb');
  expect(localStorage.getItem(syncOutboxKey(user.email))).toBe(raw);
});
it('rejects expired, future, malformed and storage-blocked hints', () => {
  saveSessionPreview(user, access); vi.advanceTimersByTime(12 * 3600 * 1000 + 1); expect(readSessionPreview()).toBeNull();
  sessionStorage.setItem(SESSION_PREVIEW_KEY, '{'); expect(readSessionPreview()).toBeNull();
  sessionStorage.setItem(SESSION_PREVIEW_KEY, JSON.stringify({ user, access, savedAt: Date.now() + 1 })); expect(readSessionPreview()).toBeNull();
  vi.stubGlobal('sessionStorage', { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); }, removeItem() { throw Error('Blocked'); } });
  expect(readSessionPreview()).toBeNull(); expect(() => saveSessionPreview(user, access)).not.toThrow(); expect(clearSessionPreview).not.toThrow();
});
it('does not preview an expired trial as active', () => {
  saveSessionPreview(user, { ...access, status: 'trial', trialEndsAt: '2026-10-01T12:00:00Z', trialDaysRemaining: 7 });
  expect(readSessionPreview()?.access.status).toBe('expired');
});
