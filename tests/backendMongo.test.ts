import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ construct: vi.fn(), connect: vi.fn() }));

vi.mock('mongodb', () => ({
  MongoClient: class {
    constructor(...args: unknown[]) { mocks.construct(...args); }
    connect() { return mocks.connect(); }
  },
}));

import { getDatabase } from '../api/_lib/mongo.js';

const globalMongo = globalThis as typeof globalThis & { kyonMongoClient?: Promise<unknown> };

function fakeClient() {
  const database = { fixture: true };
  return { database, client: { db: vi.fn().mockReturnValue(database) } };
}

describe('getDatabase with a mocked MongoClient only', () => {
  beforeEach(() => {
    delete globalMongo.kyonMongoClient;
    vi.resetAllMocks();
    // Deliberately not a MongoDB URI: even a broken mock cannot contact a database.
    vi.stubEnv('MONGODB_URI', 'offline://fixture-only');
    vi.stubEnv('MONGODB_DB', 'kyon_test');
  });

  afterEach(() => {
    delete globalMongo.kyonMongoClient;
    vi.unstubAllEnvs();
  });

  it('shares one successful connection between concurrent callers and later requests', async () => {
    const { client, database } = fakeClient();
    let resolve!: (value: typeof client) => void;
    mocks.connect.mockReturnValue(new Promise<typeof client>((done) => { resolve = done; }));
    const first = getDatabase();
    const second = getDatabase();
    expect(mocks.construct).toHaveBeenCalledExactlyOnceWith('offline://fixture-only', { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
    resolve(client);
    expect(await first).toBe(database);
    expect(await second).toBe(database);
    expect(await getDatabase()).toBe(database);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(client.db).toHaveBeenCalledWith('kyon_test');
  });

  it('clears an initially rejected promise so the next request can recover', async () => {
    const failure = new Error('Synthetic initial outage');
    const { client, database } = fakeClient();
    mocks.connect.mockRejectedValueOnce(failure).mockResolvedValueOnce(client);
    await expect(getDatabase()).rejects.toBe(failure);
    expect(globalMongo.kyonMongoClient).toBeUndefined();
    expect(await getDatabase()).toBe(database);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('shares a failed attempt, then shares the single recovery connection', async () => {
    const failure = new Error('Synthetic initial outage');
    const { client, database } = fakeClient();
    mocks.connect.mockRejectedValueOnce(failure).mockResolvedValueOnce(client);
    const failed = await Promise.allSettled([getDatabase(), getDatabase()]);
    expect(failed).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(globalMongo.kyonMongoClient).toBeUndefined();
    expect(await Promise.all([getDatabase(), getDatabase()])).toEqual([database, database]);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale rejection erase a newer cached promise', async () => {
    let reject!: (error: Error) => void;
    mocks.connect.mockReturnValue(new Promise<never>((_, fail) => { reject = fail; }));
    const pending = getDatabase();
    const { client, database } = fakeClient();
    const replacement = Promise.resolve(client);
    globalMongo.kyonMongoClient = replacement;
    const failure = new Error('Synthetic stale connection failure');
    reject(failure);
    await expect(pending).rejects.toBe(failure);
    expect(globalMongo.kyonMongoClient).toBe(replacement);
    expect(await getDatabase()).toBe(database);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a URI and does not cache that synchronous failure', async () => {
    vi.stubEnv('MONGODB_URI', '');
    await expect(getDatabase()).rejects.toThrow('MONGODB_URI is not configured.');
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(globalMongo.kyonMongoClient).toBeUndefined();
    vi.stubEnv('MONGODB_URI', 'offline://fixture-only');
    const { client, database } = fakeClient();
    mocks.connect.mockResolvedValue(client);
    expect(await getDatabase()).toBe(database);
  });

  it('retains a successful connection if selecting the database itself fails', async () => {
    const { client, database } = fakeClient();
    const failure = new Error('Synthetic invalid database option');
    client.db.mockImplementationOnce(() => { throw failure; });
    mocks.connect.mockResolvedValue(client);
    await expect(getDatabase()).rejects.toBe(failure);
    expect(globalMongo.kyonMongoClient).toBeDefined();
    expect(await getDatabase()).toBe(database);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
});
