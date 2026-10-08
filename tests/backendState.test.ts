import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, WorkoutLog } from '../src/types.js';
import type { VercelRequest, VercelResponse } from '../api/_lib/vercel.js';

const mocks = vi.hoisted(() => ({ resolveSessionAccess: vi.fn(), getDatabase: vi.fn() }));

vi.mock('../api/_lib/access.js', () => ({ resolveSessionAccess: mocks.resolveSessionAccess }));
vi.mock('../api/_lib/mongo.js', () => ({ getDatabase: mocks.getDatabase }));

import handler from '../api/state.js';

function emptyState(): AppState {
  return { unit: 'kg', routine: { id: 'routine-fixture', name: '', days: [] }, logs: [] };
}

function workout(): WorkoutLog {
  return {
    id: 'log-fixture', date: '2026-10-01', routineDayId: 'archived-day', title: 'Fixture', duration: 0, completed: false,
    exercises: [{ exerciseId: 'exercise-fixture', exerciseName: 'Fixture', sets: [{ weight: 0, reps: 0, done: false, unit: 'kg' }] }],
  };
}

type MemoryDocument = {
  _id: string;
  state: AppState;
  revision: number;
  appliedMutationIds: string[];
  createdAt: Date;
  updatedAt: Date;
  migratedAt: Date;
};

function memoryCollection() {
  let current: MemoryDocument | null = null;
  return {
    get current() { return current; },
    findOne: vi.fn(async (filter: { _id: string }) => current?._id === filter._id ? structuredClone(current) : null),
    insertOne: vi.fn(async (document: MemoryDocument) => {
      if (current) throw Object.assign(new Error('Synthetic duplicate key'), { code: 11000 });
      current = structuredClone(document);
      return { insertedId: document._id };
    }),
    updateOne: vi.fn(async (filter: { _id: string; revision: number }, update: { $set: Partial<MemoryDocument> }) => {
      if (!current || current._id !== filter._id || current.revision !== filter.revision) return { modifiedCount: 0 };
      Object.assign(current, structuredClone(update.$set));
      return { modifiedCount: 1 };
    }),
  };
}

async function invoke(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string | number | readonly string[]>,
    status: vi.fn<(code: number) => VercelResponse>(),
    json: vi.fn<(body: unknown) => VercelResponse>(),
    setHeader: vi.fn<(name: string, value: string | number | readonly string[]) => VercelResponse>(),
  };
  const res = response as unknown as VercelResponse;
  response.status.mockImplementation((code) => { response.statusCode = code; return res; });
  response.json.mockImplementation((payload) => { response.body = payload; return res; });
  response.setHeader.mockImplementation((name, value) => { response.headers[name] = value; return res; });
  const req = { method, body, headers: { host: 'app.example.invalid', ...headers } } as unknown as VercelRequest;
  await handler(req, res);
  return response;
}

describe('State API with getDatabase mocked and collections in memory only', () => {
  let collection: ReturnType<typeof memoryCollection>;
  let account: { user: { email: string; name: string }; access: { status: 'active' | 'expired'; isAdmin: boolean } };

  beforeEach(() => {
    vi.resetAllMocks();
    collection = memoryCollection();
    account = { user: { email: 'member@example.invalid', name: 'Fixture' }, access: { status: 'active', isAdmin: false } };
    mocks.resolveSessionAccess.mockResolvedValue(account);
    mocks.getDatabase.mockResolvedValue({ collection: vi.fn().mockReturnValue(collection) });
  });

  it.each(['POST', 'PATCH'])('returns 400 for malformed JSON in %s without accessing Mongo', async (method) => {
    for (const body of ['{', '', '{"state":', '[1,]']) {
      const result = await invoke(method, body);
      expect(result.statusCode).toBe(400);
    }
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PATCH'])('returns 400 for null, scalar or array body in %s', async (method) => {
    for (const body of [undefined, null, 'null', 1, true, [], '{}']) expect((await invoke(method, body)).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('rejects an array POST body even if it has a state property', async () => {
    expect((await invoke('POST', Object.assign([], { state: emptyState() }))).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('rejects an array mutation even if it has otherwise valid properties', async () => {
    const mutation = Object.assign([], { id: 'mutation-fixture', type: 'setUnit', unit: 'lb' });
    expect((await invoke('PATCH', mutation)).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('returns 400 for nested nulls in POST instead of throwing', async () => {
    expect((await invoke('POST', { state: { ...emptyState(), logs: [null] } })).statusCode).toBe(400);
    expect((await invoke('POST', { state: { ...emptyState(), routine: { id: 'routine-fixture', name: '', days: [null] } } })).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'mutation-fixture', type: 'upsertWorkout' },
    { id: 'mutation-fixture', type: 'upsertWorkout', log: null },
    { id: 'mutation-fixture', type: 'upsertWorkout', log: { ...workout(), exercises: [null] } },
    { id: 'mutation-fixture', type: 'setRoutine', routine: { id: 'routine-fixture', name: '', days: [null] } },
    { id: 'mutation-fixture', type: 'upsertWorkout', log: { ...workout(), date: ['2026-10-01'] } },
    { id: 'mutation-fixture', type: 'upsertWorkout', log: { ...workout(), date: '2026-02-29' } },
    { id: 'mutation-fixture', type: 'upsertWorkout', log: { ...workout(), duration: -1 } },
  ])('returns 400 for malformed mutation %j before requesting Mongo', async (mutation) => {
    expect((await invoke('PATCH', mutation)).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('keeps invalid JSON a 400 even if the database would be unavailable', async () => {
    mocks.getDatabase.mockRejectedValue(new Error('Synthetic outage'));
    expect((await invoke('POST', '{')).statusCode).toBe(400);
    expect((await invoke('PATCH', '{')).statusCode).toBe(400);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('preserves GET and the cache-control response contract', async () => {
    const result = await invoke('GET');
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ state: null, revision: null, userEmail: account.user.email });
    expect(result.headers['Cache-Control']).toBe('private, no-store, max-age=0');
    expect(result.headers.Vary).toBe('Cookie');
  });

  it('bootstraps JSON state once and returns the original document on duplicate bootstrap', async () => {
    const state = { ...emptyState(), logs: [workout()] };
    const first = await invoke('POST', JSON.stringify({ state }));
    expect(first.statusCode).toBe(201);
    expect(first.body).toEqual({ state, revision: 1, userEmail: account.user.email });
    expect(collection.current?._id).toBe(account.user.email);
    const duplicate = await invoke('POST', { state: emptyState() });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toMatchObject({ state, revision: 1 });
    expect((await invoke('GET')).body).toEqual({ state, revision: 1, userEmail: account.user.email });
  });

  it('keeps bootstrap insert-only under simultaneous requests', async () => {
    const results = await Promise.all([invoke('POST', { state: emptyState() }), invoke('POST', { state: emptyState() })]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(collection.current?.revision).toBe(1);
  });

  it('preserves unit, routine, workout and deleteRoutine mutation contracts', async () => {
    await invoke('POST', { state: emptyState() });
    expect((await invoke('PATCH', JSON.stringify({ id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' }))).statusCode).toBe(200);
    const routine = { id: 'new-routine', name: 'New fixture', days: [] };
    expect((await invoke('PATCH', { id: 'routine-mutation-fixture', type: 'setRoutine', routine })).statusCode).toBe(200);
    expect((await invoke('PATCH', { id: 'workout-mutation-fixture', type: 'upsertWorkout', log: workout() })).statusCode).toBe(200);
    expect((await invoke('PATCH', { id: 'delete-mutation-fixture', type: 'deleteRoutine' })).statusCode).toBe(200);
    expect(collection.current?.state).toEqual({ unit: 'lb', routine: { id: 'routine-empty', name: '', days: [] }, logs: [workout()] });
    expect(collection.current?.revision).toBe(5);
  });

  it('preserves recent mutation idempotency', async () => {
    await invoke('POST', { state: emptyState() });
    const mutation = { id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' };
    await invoke('PATCH', mutation);
    expect((await invoke('PATCH', mutation)).statusCode).toBe(200);
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.current?.revision).toBe(2);
  });

  it('preserves both disjoint concurrent mutations through revision compare-and-swap', async () => {
    await invoke('POST', { state: emptyState() });
    const routine = { id: 'new-routine', name: 'New fixture', days: [] };
    const results = await Promise.all([
      invoke('PATCH', { id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' }),
      invoke('PATCH', { id: 'routine-mutation-fixture', type: 'setRoutine', routine }),
    ]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(collection.current?.state).toEqual({ ...emptyState(), unit: 'lb', routine });
    expect(collection.current?.revision).toBe(3);
  });

  it('preserves the 409 response for mutations before initial synchronization', async () => {
    expect((await invoke('PATCH', { id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' })).statusCode).toBe(409);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('requires authentication before allowing state reads', async () => {
    account.access.status = 'expired';
    mocks.resolveSessionAccess.mockResolvedValueOnce(null);
    expect((await invoke('GET')).statusCode).toBe(401);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('keeps expired users out of all state reads and writes', async () => {
    account.access.status = 'expired';
    expect((await invoke('GET', undefined, { 'x-kyon-user-email': account.user.email })).statusCode).toBe(402);
    expect((await invoke('POST', { state: emptyState() })).statusCode).toBe(402);
    expect((await invoke('PATCH', { id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' })).statusCode).toBe(402);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('preserves the origin gate without database access', async () => {
    account.access.status = 'active';
    expect((await invoke('PATCH', { id: 'unit-mutation-fixture', type: 'setUnit', unit: 'lb' }, { origin: 'https://evil.example.invalid' })).statusCode).toBe(403);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it('returns 405 for unsupported methods without connecting to Mongo', async () => {
    mocks.getDatabase.mockRejectedValue(new Error('Synthetic outage'));
    const result = await invoke('OPTIONS');
    expect(result.statusCode).toBe(405);
    expect(result.headers.Allow).toBe('GET, POST, PATCH');
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST', 'PATCH'])('rejects another session owner before state access in %s', async (method) => {
    const result = await invoke(method, { state: emptyState() }, { 'x-kyon-user-email': 'other@example.invalid' });
    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({ code: 'SESSION_OWNER_MISMATCH' });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(collection.findOne).not.toHaveBeenCalled();
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a mismatched owner for an expired GET before the access-status gate', async () => {
    account.access.status = 'expired';
    const result = await invoke('GET', undefined, { 'x-kyon-user-email': 'other@example.invalid' });
    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({ code: 'SESSION_OWNER_MISMATCH' });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(collection.findOne).not.toHaveBeenCalled();
  });

  it('accepts the matching owner and echoes the authenticated identity', async () => {
    const header = { 'x-kyon-user-email': ` ${account.user.email.toUpperCase()} ` };
    expect((await invoke('POST', { state: emptyState() }, header)).body).toMatchObject({ userEmail: account.user.email });
    expect((await invoke('PATCH', { id: 'owner-unit-fixture', type: 'setUnit', unit: 'lb' }, header)).body).toMatchObject({ userEmail: account.user.email });
    expect((await invoke('GET', undefined, header)).body).toMatchObject({ userEmail: account.user.email });
  });

  it.each(['', ' ', 'member@example.invalid,other@example.invalid'])('rejects invalid explicit owner header %j', async (owner) => {
    expect((await invoke('GET', undefined, { 'x-kyon-user-email': owner })).statusCode).toBe(409);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it.each(['deleteRoutine', 'setRoutine'])('repairs an oversized legacy plan with %s without dropping workout history', async (type) => {
    const state = { ...emptyState(), logs: [workout()] };
    await invoke('POST', { state });
    const oversizedRoutine = {
      id: 'legacy-routine', name: 'Legacy fixture',
      days: [{ id: 'legacy-day', dayOfWeek: 1, title: 'Legacy', focus: '', color: '#fff', duration: 40,
        exercises: [{ id: 'legacy-exercise', name: 'Legacy', sets: 101, reps: '10', rest: 60 }] }],
    };
    // Seed an existing malformed/oversized document in memory; never alter Atlas.
    await collection.updateOne({ _id: account.user.email, revision: 1 }, { $set: { state: { ...state, routine: oversizedRoutine } } });
    const mutation = type === 'deleteRoutine'
      ? { id: 'legacy-repair-fixture', type }
      : { id: 'legacy-repair-fixture', type, routine: emptyState().routine };
    expect((await invoke('PATCH', mutation)).statusCode).toBe(200);
    expect(collection.current?.state.logs).toEqual(state.logs);
    expect(collection.current?.state.routine.days).toEqual([]);
  });
});
