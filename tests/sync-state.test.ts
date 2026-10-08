import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../src/data';
import { SessionEpoch } from '../src/syncSession';
import {
  applySyncMutation,
  DurableSyncSession,
  replaySyncMutations,
  saveMigrationBackup,
  syncMigrationBackupKey,
  syncOutboxKey,
  SyncStorageError,
  type SyncRemoteState,
  type SyncRequestContext,
} from '../src/syncState';
import type { AppState, StateMutation, WorkoutLog } from '../src/types';

const A = 'audit-a@example.invalid';
const B = 'audit-b@example.invalid';

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('synthetic quota exceeded');
    this.values.set(key, value);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function workout(id: string, date = '2026-10-08'): WorkoutLog {
  return {
    id, date, routineDayId: 'audit-day', title: 'Entrenamiento de prueba', duration: 30, completed: true,
    exercises: [{ exerciseId: 'audit-exercise', exerciseName: 'Press', sets: [{ weight: 10, reps: 10, done: true, unit: 'kg' }] }],
  };
}

function upsert(id = 'mutation-workout-1', date = '2026-10-08'): StateMutation {
  return { id, type: 'upsertWorkout', log: workout(`log-${id}`, date) };
}

const setUnit: StateMutation = { id: 'mutation-unit-0001', type: 'setUnit', unit: 'lb' };
const response = (state = createInitialState(), revision = 1, userEmail = A): SyncRemoteState => ({ state, revision, userEmail });

function harness(options: {
  email?: string;
  storage?: MemoryStorage;
  initial?: AppState;
  isCurrent?: () => boolean;
  send?: (mutation: StateMutation, context: SyncRequestContext) => Promise<SyncRemoteState>;
  retry?: boolean;
} = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const onState = vi.fn<(state: AppState) => void>();
  const onError = vi.fn<(reason: unknown) => void>();
  let server = createInitialState();
  let revision = 1;
  const send = vi.fn(options.send ?? (async (mutation: StateMutation, context: SyncRequestContext) => {
    server = applySyncMutation(server, mutation);
    return response(server, ++revision, context.userEmail);
  }));
  const session = new DurableSyncSession({
    userEmail: options.email ?? A,
    storage,
    initialState: options.initial,
    isCurrent: options.isCurrent ?? (() => true),
    send, onState, onError,
    delay: async () => undefined,
    shouldRetry: () => options.retry ?? false,
  });
  return { session, storage, send, onState, onError };
}

describe('durable owner-scoped synchronization', () => {
  it('persists before publishing and does not send before authenticated hydration', async () => {
    const h = harness();
    expect(h.session.enqueue(upsert())).toBe(true);
    await h.session.flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.session.state.logs).toHaveLength(1);
    const saved = JSON.parse(h.storage.getItem(syncOutboxKey(A))!);
    expect(saved.pending[0].id).toBe('mutation-workout-1');
    expect(saved.userEmail).toBe(A);
    expect(h.onState).toHaveBeenCalledWith(h.session.state);
  });

  it('replays pending work over a fresh server state instead of erasing it', async () => {
    const gate = deferred<SyncRemoteState>();
    const h = harness({ send: () => gate.promise });
    h.session.enqueue(upsert());
    const remote = createInitialState();
    remote.logs = [workout('remote-log', '2026-10-07')];
    h.session.reconcile(response(remote));
    expect(h.session.state.logs.map((log) => log.id)).toEqual(['remote-log', 'log-mutation-workout-1']);
    h.session.close();
    gate.resolve(response(remote, 2));
    await h.session.flush();
    expect(h.session.pendingCount).toBe(1);
  });

  it('keeps a failed workout when a later unit change is queued', async () => {
    const h = harness({ send: async () => { throw new Error('synthetic offline'); } });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    await h.session.flush();
    h.session.enqueue(setUnit);
    await h.session.flush();
    expect(h.session.pendingCount).toBe(2);
    expect(h.session.state.logs).toHaveLength(1);
    expect(h.session.state.unit).toBe('lb');
    expect(JSON.parse(h.storage.getItem(syncOutboxKey(A))!).pending).toHaveLength(2);
  });

  it('restores failed work after reload and acknowledges it using the original id', async () => {
    const failed = harness({ send: async () => { throw new Error('synthetic offline'); } });
    failed.session.reconcile(response());
    failed.session.enqueue(upsert());
    await failed.session.flush();
    failed.session.close();
    const recovered = harness({ storage: failed.storage });
    expect(recovered.session.restoredFromStorage).toBe(true);
    expect(recovered.session.state.logs).toHaveLength(1);
    recovered.session.reconcile(response());
    await recovered.session.flush();
    expect(recovered.send.mock.calls[0][0].id).toBe('mutation-workout-1');
    expect(recovered.session.pendingCount).toBe(0);
    expect(recovered.session.state.logs).toHaveLength(1);
    expect(JSON.parse(recovered.storage.getItem(syncOutboxKey(A))!).pending).toEqual([]);
  });

  it('never dispatches the old queue after logout/login and does not wait for its in-flight fetch', async () => {
    const epoch = new SessionEpoch();
    const token = epoch.capture();
    const gate = deferred<SyncRemoteState>();
    const storage = new MemoryStorage();
    const old = harness({ storage, isCurrent: () => epoch.isCurrent(token), send: () => gate.promise });
    old.session.reconcile(response());
    old.session.enqueue(upsert());
    old.session.enqueue(setUnit);
    const oldWorker = old.session.flush();
    expect(old.send).toHaveBeenCalledTimes(1);
    const signal = old.send.mock.calls[0][1].signal;
    epoch.advance();
    old.session.close();
    old.onState.mockClear();
    const next = harness({ email: B, storage });
    next.session.reconcile(response(createInitialState(), 1, B));
    next.session.enqueue(setUnit);
    await next.session.flush();
    expect(next.session.state.unit).toBe('lb');
    expect(next.send.mock.calls[0][1].userEmail).toBe(B);
    expect(signal.aborted).toBe(true);
    gate.resolve(response(applySyncMutation(createInitialState(), upsert()), 2));
    await oldWorker;
    expect(old.send).toHaveBeenCalledTimes(1);
    expect(old.onState).not.toHaveBeenCalled();
    expect(old.session.pendingCount).toBe(2);
    expect(JSON.parse(storage.getItem(syncOutboxKey(A))!).pending).toHaveLength(2);
    expect(JSON.parse(storage.getItem(syncOutboxKey(B))!).pending).toEqual([]);
  });

  it('ignores late 402/errors from an old session instead of locking the new user', async () => {
    const gate = deferred<SyncRemoteState>();
    const h = harness({ send: () => gate.promise });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    const worker = h.session.flush();
    h.session.close();
    gate.reject(Object.assign(new Error('old trial expired'), { status: 402 }));
    await worker;
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.session.pendingCount).toBe(1);
  });

  it('checks the session again before each retry', async () => {
    const epoch = new SessionEpoch();
    const token = epoch.capture();
    const h = harness({ isCurrent: () => epoch.isCurrent(token), retry: true, send: async () => {
      epoch.advance();
      throw new Error('old request failed after logout');
    } });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    await h.session.flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('retries transient failures at most three times with the same mutation id', async () => {
    const h = harness({ retry: true, send: async () => { throw new Error('offline'); } });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    await h.session.flush();
    expect(h.send).toHaveBeenCalledTimes(3);
    expect(new Set(h.send.mock.calls.map(([mutation]) => mutation.id)).size).toBe(1);
    expect(h.session.pendingCount).toBe(1);
    expect(h.onError).toHaveBeenCalledTimes(1);
  });

  it('keeps later optimistic work visible while acknowledging only the first mutation', async () => {
    const first = deferred<SyncRemoteState>();
    const second = deferred<SyncRemoteState>();
    let calls = 0;
    const h = harness({ send: () => ++calls === 1 ? first.promise : second.promise });
    const m1 = upsert();
    const m2 = upsert('mutation-workout-2', '2026-10-09');
    h.session.reconcile(response());
    h.session.enqueue(m1);
    h.session.enqueue(m2);
    h.onState.mockClear();
    const s1 = applySyncMutation(createInitialState(), m1);
    first.resolve(response(s1, 2));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.session.pendingCount).toBe(1);
    expect(h.session.state.logs).toHaveLength(2);
    expect(h.onState.mock.calls.every(([state]) => state.logs.length === 2)).toBe(true);
    second.resolve(response(applySyncMutation(s1, m2), 3));
    await h.session.flush();
    expect(h.session.pendingCount).toBe(0);
    expect(h.session.state.logs).toHaveLength(2);
  });

  it('ignores an older GET revision after a successful PATCH', async () => {
    const h = harness();
    const newer = applySyncMutation(createInitialState(), upsert());
    h.session.reconcile(response(newer, 5));
    h.session.reconcile(response(createInitialState(), 3));
    expect(h.session.revision).toBe(5);
    expect(h.session.state.logs).toHaveLength(1);
  });

  it('rejects a different owner without adopting or acknowledging its response', async () => {
    const h = harness({ send: async () => response(createInitialState(), 2, B) });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    await h.session.flush();
    expect(h.session.pendingCount).toBe(1);
    expect(h.session.state.logs).toHaveLength(1);
    expect(h.onError).toHaveBeenCalled();
    expect(() => h.session.reconcile(response(createInitialState(), 2, B))).toThrow('otra cuenta');
  });

  it('refuses a commit when storage fails, so the caller can retain its workout draft', () => {
    const h = harness();
    h.storage.failWrites = true;
    expect(() => h.session.enqueue(upsert())).toThrow(SyncStorageError);
    expect(h.session.pendingCount).toBe(0);
    expect(h.session.state.logs).toEqual([]);
    expect(h.onState).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps the original id pending if persisting the server acknowledgement fails', async () => {
    const gate = deferred<SyncRemoteState>();
    const h = harness({ send: () => gate.promise });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    h.storage.failWrites = true;
    gate.resolve(response(applySyncMutation(createInitialState(), upsert()), 2));
    await h.session.flush();
    expect(h.session.pendingCount).toBe(1);
    expect(h.onError).toHaveBeenCalledWith(expect.any(SyncStorageError));
    expect(JSON.parse(h.storage.getItem(syncOutboxKey(A))!).pending[0].id).toBe('mutation-workout-1');
  });

  it('does not silently treat a corrupt or wrong-owner outbox as empty', () => {
    const storage = new MemoryStorage();
    storage.values.set(syncOutboxKey(A), '{broken');
    expect(() => harness({ storage })).toThrow(SyncStorageError);
    expect(storage.getItem(syncOutboxKey(A))).toBe('{broken');
    storage.values.set(syncOutboxKey(A), JSON.stringify({ version: 1, userEmail: B, baseState: createInitialState(), revision: null, pending: [] }));
    expect(() => harness({ storage })).toThrow(SyncStorageError);
  });

  it('detaches queued payloads from editable UI objects', () => {
    const h = harness();
    const mutation = upsert();
    h.session.enqueue(mutation);
    if (mutation.type === 'upsertWorkout') mutation.log.title = 'changed after enqueue';
    expect(h.session.state.logs[0].title).toBe('Entrenamiento de prueba');
  });

  it('does not loop forever when a request rejects with undefined', async () => {
    const h = harness({ send: () => Promise.reject(undefined) });
    h.session.reconcile(response());
    h.session.enqueue(upsert());
    await h.session.flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.session.pendingCount).toBe(1);
    expect(h.onError).toHaveBeenCalledTimes(1);
  });
});

describe('backward-compatible state and migration protection', () => {
  it('preserves historical logs when deleting a routine and replaying pending work', () => {
    const state = createInitialState();
    state.logs = [workout('history')];
    expect(replaySyncMutations(state, [{ id: 'mutation-delete-1', type: 'deleteRoutine' }]).logs).toEqual(state.logs);
  });

  it('keeps the original migration candidate when another browser already initialized the account', () => {
    const storage = new MemoryStorage();
    const original = applySyncMutation(createInitialState(), upsert());
    saveMigrationBackup(storage, A, original);
    saveMigrationBackup(storage, A, createInitialState());
    expect(JSON.parse(storage.getItem(syncMigrationBackupKey(A))!)).toEqual(original);
  });

  it('blocks migration before any request if the backup cannot be saved', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(() => saveMigrationBackup(storage, A, createInitialState())).toThrow(SyncStorageError);
  });
});
