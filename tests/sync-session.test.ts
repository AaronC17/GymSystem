import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableSyncDelay, AuthRequestQueue, normalizeUserEmail, SessionEpoch } from '../src/syncSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('session epochs and cookie-changing requests', () => {
  it('invalidates every captured continuation and aborts its requests', () => {
    const epoch = new SessionEpoch();
    const old = epoch.capture();
    const next = epoch.advance();
    expect(old.signal.aborted).toBe(true);
    expect(epoch.isCurrent(old)).toBe(false);
    expect(epoch.isCurrent(next)).toBe(true);
    epoch.advance();
    expect(epoch.isCurrent(next)).toBe(false);
  });

  it('ignores a login/session/migration response even when the request ignores abort', async () => {
    const epoch = new SessionEpoch();
    const token = epoch.capture();
    const response = deferred<string>();
    const adopt = vi.fn();
    const pending = response.promise.then((user) => {
      if (epoch.isCurrent(token)) adopt(user);
    });
    epoch.advance();
    response.resolve('old-user');
    await pending;
    expect(adopt).not.toHaveBeenCalled();
  });

  it('does not issue the new login POST until the previous logout DELETE settles', async () => {
    const queue = new AuthRequestQueue();
    const logout = deferred<void>();
    const operations: string[] = [];
    const first = queue.run(() => { operations.push('DELETE'); return logout.promise; });
    const second = queue.run(async () => { operations.push('POST login B'); return 'B'; });
    await Promise.resolve();
    expect(operations).toEqual(['DELETE']);
    logout.resolve();
    await first;
    expect(await second).toBe('B');
    expect(operations).toEqual(['DELETE', 'POST login B']);
  });

  it('keeps an in-flight login, logout, and next login in cookie response order', async () => {
    const queue = new AuthRequestQueue();
    const firstLogin = deferred<void>();
    const operations: string[] = [];
    const a = queue.run(() => { operations.push('login A'); return firstLogin.promise; });
    const out = queue.run(async () => { operations.push('logout A'); });
    const b = queue.run(async () => { operations.push('login B'); });
    await Promise.resolve();
    expect(operations).toEqual(['login A']);
    firstLogin.resolve();
    await Promise.all([a, out, b]);
    expect(operations).toEqual(['login A', 'logout A', 'login B']);
  });

  it('allows the next operation after a failed logout without hiding that failure', async () => {
    const queue = new AuthRequestQueue();
    const error = new Error('offline');
    const first = queue.run(async () => { throw error; });
    const next = queue.run(async () => 'new session');
    await expect(first).rejects.toBe(error);
    expect(await next).toBe('new session');
  });

  it('can skip superseded authentication work before making any request', async () => {
    const queue = new AuthRequestQueue();
    const epoch = new SessionEpoch();
    const token = epoch.capture();
    const fetch = vi.fn();
    const pending = queue.run(async () => {
      if (!epoch.isCurrent(token)) return;
      fetch();
    });
    epoch.advance();
    await pending;
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels retry delays immediately when the epoch closes', async () => {
    vi.useFakeTimers();
    const epoch = new SessionEpoch();
    const wait = abortableSyncDelay(900, epoch.capture().signal);
    expect(vi.getTimerCount()).toBe(1);
    epoch.advance();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create timers for an already-aborted request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await abortableSyncDelay(450, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes owners consistently with the existing per-user caches', () => {
    expect(normalizeUserEmail('  AUDIT-A@EXAMPLE.INVALID ')).toBe('audit-a@example.invalid');
  });
});
