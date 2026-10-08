import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, ApiOwnershipError, ApiResponseError, bootstrapRemoteState, changePasswordRemote, getRemoteSession, getRemoteState,
  loginRemote, logoutRemote, mutateRemoteState, STATE_OWNER_HEADER,
} from '../src/api';
import { createInitialState } from '../src/data';

const email = 'audit-a@example.invalid';
const access = { status: 'active', trialEndsAt: null, trialDaysRemaining: 0, isAdmin: false };
const mutation = { id: 'mutation-unit-0001', type: 'setUnit' as const, unit: 'lb' as const };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const validState = () => ({ state: createInitialState(), revision: 1, userEmail: email });

beforeEach(() => {
  // Every test uses a synthetic response. Never fall through to native fetch.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled for API client tests'); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('API success/error payload validation', () => {
  it.each([null, {}, [], 'text', 1, { state: {}, revision: 1, userEmail: email },
    { state: createInitialState(), revision: '1', userEmail: email },
    { state: createInitialState(), revision: 0, userEmail: email },
    { state: createInitialState(), revision: 1.5, userEmail: email },
    { state: createInitialState(), revision: 1 },
    { state: null, revision: 1, userEmail: email },
  ])('rejects malformed HTTP 200 payload %#', async (payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload));
    await expect(getRemoteState({ userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects HTTP 200 HTML instead of treating it as empty MongoDB state', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(getRemoteState({ userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('rejects null nested state without leaking a schema TypeError', async () => {
    const payload = validState();
    const malformed = { ...payload, state: { ...payload.state, routine: { ...payload.state.routine, days: [null] } } };
    vi.mocked(fetch).mockResolvedValueOnce(json(malformed));
    await expect(getRemoteState({ userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('accepts an explicitly uninitialized account only for GET', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ state: null, revision: null, userEmail: email }));
    expect(await getRemoteState({ userEmail: email })).toEqual({ state: null, revision: null, userEmail: email });
    await expect(mutateRemoteState(mutation, { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
    await expect(bootstrapRemoteState(createInitialState(), { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('normalizes and validates the owner and revision of a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...validState(), userEmail: ' AUDIT-A@EXAMPLE.INVALID ' }));
    expect(await getRemoteState({ userEmail: email })).toEqual(validState());
  });

  it('rejects a valid state belonging to another cookie user', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...validState(), userEmail: 'audit-b@example.invalid' }));
    await expect(getRemoteState({ userEmail: email })).rejects.toBeInstanceOf(ApiOwnershipError);
  });

  it.each(['unauthorized', null, [], 7])('preserves HTTP 401 even with a non-object error body %#', async (payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload, 401));
    await expect(getRemoteState({ userEmail: email })).rejects.toMatchObject({ name: 'ApiError', status: 401 });
  });

  it('validates access information on an expired-trial error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'Expired', access: { ...access, status: 'expired' } }, 402));
    await expect(getRemoteState({ userEmail: email })).rejects.toMatchObject({ status: 402, access: { status: 'expired', isAdmin: false } });
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'Expired', access: { isAdmin: 'yes' } }, 402));
    await expect(getRemoteState({ userEmail: email })).rejects.toMatchObject({ status: 402, access: undefined });
  });

  it.each([null, {}, { user: {}, access }, { user: { name: 'A', email }, access: { ...access, isAdmin: 'yes' } },
    { user: { name: 'A', email }, access: { ...access, trialEndsAt: 'not-a-date' } },
    { user: { name: 'A', email }, access: { ...access, status: ['active'] } },
  ])('rejects malformed session payload %#', async (payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload));
    await expect(getRemoteSession()).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('does not adopt a successful login response for a different account', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user: { name: 'B', email: 'audit-b@example.invalid' }, access }));
    await expect(loginRemote(email, 'synthetic-password', true)).rejects.toBeInstanceOf(ApiOwnershipError);
  });

  it('requires an actual successful logout acknowledgement', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}));
    await expect(logoutRemote()).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('changes a password only through an authenticated owner-bound POST', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: true }));
    expect(await changePasswordRemote('fixture-current-123', 'fixture-next-456', { userEmail: email })).toEqual({ ok: true });
    const [path, init] = vi.mocked(fetch).mock.calls[0];
    expect(path).toBe('/api/password');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get(STATE_OWNER_HEADER)).toBe(email);
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual({ currentPassword: 'fixture-current-123', newPassword: 'fixture-next-456' });
  });

  it('does not report a password change as successful without acknowledgement', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: false }));
    await expect(changePasswordRemote('fixture-current-123', 'fixture-next-456', { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });
});

describe('request ownership and cancellation', () => {
  it('binds every state GET, POST and PATCH to the expected owner without changing legacy mutation bodies', async () => {
    vi.mocked(fetch).mockImplementation(async () => json(validState()));
    await getRemoteState({ userEmail: ` ${email.toUpperCase()} ` });
    await bootstrapRemoteState(createInitialState(), { userEmail: email });
    await mutateRemoteState(mutation, { userEmail: email });
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(new Headers(init?.headers).get(STATE_OWNER_HEADER)).toBe(email);
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
    }
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toEqual(mutation);
  });

  it('does not make a request for an already-cancelled epoch', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mutateRemoteState(mutation, { userEmail: email, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates cancellation to an in-flight request', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const result = getRemoteState({ userEmail: email, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
  });

  it('bounds stalled requests and clears its timeout after completion', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true });
    }));
    const request = getRemoteState({ userEmail: email, timeoutMs: 100 });
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a backend ownership rejection and its code', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'Owner mismatch', code: 'SESSION_OWNER_MISMATCH' }, 403));
    const error = await getRemoteState({ userEmail: email }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'SESSION_OWNER_MISMATCH' });
  });

  it('does not accept a response when mocked fetch ignores a cancelled signal', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((yes) => { resolve = yes; }));
    const controller = new AbortController();
    const result = getRemoteState({ userEmail: email, signal: controller.signal });
    controller.abort();
    resolve(json(validState()));
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
