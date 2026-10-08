import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SocialDashboard, SocialWorkoutDetail } from '../src/socialTypes.js';
import type { VercelRequest, VercelResponse } from '../api/_lib/vercel.js';

const mocks = vi.hoisted(() => ({ access: vi.fn(), database: vi.fn() }));
vi.mock('../api/_lib/access.js', () => ({ resolveSessionAccess: mocks.access }));
vi.mock('../api/_lib/mongo.js', () => ({ getDatabase: mocks.database }));
import handler from '../api/social.js';
import { normalizedSocialEmail, parseSocialAction, socialPairId } from '../api/_lib/social.js';

// Mongo's relevant operators are modeled here, including unique _id/upsert
// failure. No database connection or network is used by these handler tests.
type Doc = Record<string, any>;
function values(document: Doc, path: string): any[] {
  const parts = path.split('.');
  function walk(value: any, index: number): any[] {
    if (index === parts.length) return [value];
    if (Array.isArray(value) && !/^\d+$/.test(parts[index])) return value.flatMap((entry) => walk(entry, index));
    return walk(value?.[parts[index]], index + 1);
  }
  return walk(document, 0);
}
function equal(a: any, b: any) { return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b; }
function matches(document: Doc, filter: Doc) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = values(document, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, value]: [string, any]) => {
        if (operator === '$in') return actual.some((entry) => value.includes(entry));
        if (operator === '$lt') return actual.some((entry) => entry < value);
        if (operator === '$exists') return actual.some((entry) => entry !== undefined) === value;
        throw new Error(`Unsupported filter ${operator}`);
      });
    }
    return actual.some((entry) => Array.isArray(entry) ? entry.includes(expected) : equal(entry, expected));
  });
}
function memoryDb() {
  const data = new Map<string, Map<string, Doc>>();
  const collection = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    const documents = data.get(name)!;
    const insert = (document: Doc) => {
      if (documents.has(document._id)) throw Object.assign(new Error('Synthetic duplicate'), { code: 11000 });
      documents.set(document._id, structuredClone(document));
    };
    return {
      documents,
      findOne: async (filter: Doc) => structuredClone([...documents.values()].find((document) => matches(document, filter)) ?? null),
      insertOne: async (document: Doc) => { insert(document); return { insertedId: document._id }; },
      replaceOne: async (filter: Doc, document: Doc) => {
        const current = [...documents.values()].find((entry) => matches(entry, filter));
        if (!current) return { modifiedCount: 0 };
        documents.set(current._id, structuredClone(document)); return { modifiedCount: 1 };
      },
      deleteOne: async (filter: Doc) => {
        const current = [...documents.values()].find((entry) => matches(entry, filter));
        return { deletedCount: current && documents.delete(current._id) ? 1 : 0 };
      },
      updateOne: async (filter: Doc, update: Doc, options?: Doc) => {
        let current = [...documents.values()].find((entry) => matches(entry, filter));
        let inserted = false;
        if (!current && options?.upsert) { const candidate: Doc = { _id: filter._id, ...structuredClone(update.$setOnInsert) }; insert(candidate); current = documents.get(candidate._id)!; inserted = true; }
        if (!current) return { modifiedCount: 0 };
        const previous = JSON.stringify(current);
        Object.assign(current, structuredClone(update.$set ?? {}));
        for (const [key, value] of Object.entries(update.$inc ?? {})) current[key] = (current[key] ?? 0) + (value as number);
        for (const [key, value] of Object.entries(update.$push ?? {})) (current[key] ??= []).push(structuredClone(value));
        for (const [key, value] of Object.entries(update.$pull ?? {})) current[key] = current[key].filter((entry: Doc) => !matches(entry, value as Doc));
        for (const [key, value] of Object.entries(update.$addToSet ?? {})) { current[key] ??= []; if (!current[key].includes(value)) current[key].push(value); }
        return { modifiedCount: previous !== JSON.stringify(current) ? 1 : 0, upsertedCount: inserted ? 1 : 0 };
      },
      find: (filter: Doc) => {
        let result = [...documents.values()].filter((entry) => matches(entry, filter));
        const cursor = {
          sort: (sort: Doc) => { result.sort((a, b) => { for (const [key, direction] of Object.entries(sort)) { if (a[key] < b[key]) return -(direction as number); if (a[key] > b[key]) return direction as number; } return 0; }); return cursor; },
          limit: (limit: number) => { result = result.slice(0, limit); return cursor; },
          toArray: async () => structuredClone(result),
        };
        return cursor;
      },
    };
  };
  return { collection: vi.fn(collection) };
}

const alice = { email: 'alice@example.invalid', name: 'Alice <script>' };
const bob = { email: 'bob@example.invalid', name: 'Bob' };
const stranger = { email: 'stranger@example.invalid', name: 'Stranger' };
let user = alice;
let db: ReturnType<typeof memoryDb>;
let expired = false;
async function request(body?: unknown, method = body === undefined ? 'GET' : 'POST', headers: Doc = {}, query: Doc = {}) {
  const response = { statusCode: 200, body: null as unknown, headers: {} as Doc };
  const res = {
    status(code: number) { response.statusCode = code; return res; },
    json(payload: unknown) { response.body = payload; return res; },
    setHeader(name: string, value: unknown) { response.headers[name] = value; return res; },
  } as VercelResponse;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const entry of Array.isArray(value) ? value : [value]) params.append(key, String(entry));
  await handler({ method, body, url: `/api/social?${params}`, headers: { host: 'app.example.invalid', 'x-kyon-user-email': user.email, ...headers } } as unknown as VercelRequest, res);
  return { ...response, dashboard: response.body as SocialDashboard };
}
async function inviteAndAccept() {
  user = alice;
  const invitation = (await request({ type: 'invite', email: bob.email })).dashboard.invitations[0];
  user = bob;
  expect((await request({ type: 'accept', invitationId: invitation.id })).statusCode).toBe(200);
  user = alice;
  return invitation;
}
function seedLogs(email = alice.email) {
  db.collection('userStates').documents.set(email, { _id: email, state: { unit: 'kg', routine: { id: 'routine', name: '', days: [] }, logs: [{ id: 'workout-1', date: '2026-10-01', routineDayId: 'day-1', title: 'Secret exercises', duration: 42, completed: true, exercises: [{ exerciseId: 'e1', exerciseName: 'SECRET EXERCISE', sets: [{ done: true, reps: 10, weight: 123, unit: 'kg' }] }] }] } });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  user = alice; expired = false; db = memoryDb();
  for (const person of [alice, bob, stranger]) db.collection('users').documents.set(person.email, { _id: person.email, name: person.name });
  mocks.database.mockResolvedValue(db);
  mocks.access.mockImplementation(async () => ({ user, access: { status: expired ? 'expired' : 'active' } }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('social handler security and validation', () => {
  it('requires session, required matching owner, origin, and active access before DB access', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect((await request()).statusCode).toBe(401);
    expect((await request(undefined, 'GET', { 'x-kyon-user-email': undefined })).statusCode).toBe(409);
    expect((await request(undefined, 'GET', { 'x-kyon-user-email': bob.email })).statusCode).toBe(409);
    expect((await request({ type: 'setSharing', sharing: true }, 'POST', { origin: 'https://evil.invalid' })).statusCode).toBe(403);
    expired = true; expect((await request()).statusCode).toBe(402);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('returns private dashboards and only allows GET/POST', async () => {
    const result = await request();
    expect(result.headers['Cache-Control']).toContain('no-store');
    expect(result.dashboard.me.sharing).toBe(false);
    expect(result.dashboard.me.stats?.completedWorkouts).toBe(0);
    expect((await request(undefined, 'DELETE')).statusCode).toBe(405);
  });
  it.each(['{', 'null', [], { type: 'setSharing', sharing: 'true' }, { type: 'invite', email: 'bad\r\naddress' }])('rejects malformed action %j before Mongo', async (body) => {
    expect((await request(body, 'POST')).statusCode).toBe(400); expect(mocks.database).not.toHaveBeenCalled();
  });
  it('normalizes bounded email and rejects invalid calendar/range/target', () => {
    expect(normalizedSocialEmail(' BOB@EXAMPLE.INVALID ')).toBe(bob.email);
    expect(normalizedSocialEmail(`${'a'.repeat(65)}@example.invalid`)).toBeNull();
    expect(socialPairId(alice.email, bob.email)).toBe(socialPairId(bob.email, alice.email));
    const goal = { type: 'createGoal', title: 'Goal', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: true };
    for (const override of [{ startDate: '2026-02-30' }, { target: 101 }, { target: 1.1 }, { endDate: '2026-09-30' }, { endDate: '2027-01-01' }, { title: ' ' }]) expect(() => parseSocialAction({ ...goal, ...override })).toThrow();
  });
});

describe('durable addressed invitations', () => {
  it('rejects nonexistent recipients without creating future invitations', async () => {
    const result = await request({ type: 'invite', email: ' NEW@EXAMPLE.INVALID ' });
    expect(result.statusCode).toBe(404); expect(result.body).toEqual({ message: 'No encontramos esa cuenta.' });
    expect(db.collection('socialRelationships').documents.size).toBe(0);
    expect(db.collection('socialInviteQuotas').documents.size).toBe(0);
    user = { email: 'new@example.invalid', name: 'New account' };
    expect((await request()).dashboard.invitations).toEqual([]);
  });
  it('rejects self, duplicate/reverse invite, spoof acceptance and wrong cancel audience', async () => {
    expect((await request({ type: 'invite', email: alice.email })).statusCode).toBe(400);
    const initial = await request({ type: 'invite', email: bob.email }); const invitation = initial.dashboard.invitations[0];
    expect((await request({ type: 'invite', email: bob.email })).statusCode).toBe(409);
    user = stranger; expect((await request({ type: 'accept', invitationId: invitation.id })).statusCode).toBe(404);
    user = bob; expect((await request({ type: 'invite', email: alice.email })).statusCode).toBe(409);
    expect((await request({ type: 'cancel', invitationId: invitation.id })).statusCode).toBe(404);
    expect((await request()).dashboard.friends).toHaveLength(0);
    expect((await request({ type: 'decline', invitationId: invitation.id })).statusCode).toBe(200);
  });
  it('CAS guarantees a single relationship under racing invites', async () => {
    const results = await Promise.all([request({ type: 'invite', email: bob.email }), request({ type: 'invite', email: bob.email })]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(db.collection('socialRelationships').documents.size).toBe(1);
  });
  it('enforces persisted per-sender daily quota and renew cooldown', async () => {
    for (let index = 0; index < 11; index++) await db.collection('users').insertOne({ _id: index === 10 ? 'eleventh@example.invalid' : `new${index}@example.invalid`, name: 'Registered person' });
    for (let index = 0; index < 10; index++) expect((await request({ type: 'invite', email: `new${index}@example.invalid` })).statusCode).toBe(200);
    expect((await request({ type: 'invite', email: 'eleventh@example.invalid' })).statusCode).toBe(429);
    expect(db.collection('socialInviteQuotas').documents.values().next().value?.count).toBe(10);
    const old = (await request()).dashboard.invitations.find((invitation) => invitation.toEmail === 'new0@example.invalid')!;
    expect((await request({ type: 'cancel', invitationId: old.id })).statusCode).toBe(200);
    expect((await request({ type: 'invite', email: 'new0@example.invalid' })).statusCode).toBe(429);
    vi.setSystemTime(new Date('2026-10-09T13:00:00Z'));
    const renewed = await request({ type: 'invite', email: 'new0@example.invalid' });
    expect(renewed.statusCode).toBe(200); expect(db.collection('socialRelationships').documents.size).toBe(10);
  });
  it('only sender can cancel and old invitation IDs cannot accept renewed invitation', async () => {
    const old = (await request({ type: 'invite', email: bob.email })).dashboard.invitations[0];
    expect((await request({ type: 'cancel', invitationId: old.id })).statusCode).toBe(200);
    vi.setSystemTime(new Date('2026-10-10T13:00:00Z'));
    const renewed = (await request({ type: 'invite', email: bob.email })).dashboard.invitations[0];
    expect(renewed.id).not.toBe(old.id); user = bob;
    expect((await request({ type: 'accept', invitationId: old.id })).statusCode).toBe(404);
    expect((await request({ type: 'accept', invitationId: renewed.id })).statusCode).toBe(200);
  });
});

describe('privacy, goals, posts and cheers', () => {
  it('caps completed goal progress to its target without duplicating the same session', async () => {
    seedLogs();
    const state = db.collection('userStates').documents.get(alice.email)!.state;
    state.logs.push({ ...structuredClone(state.logs[0]), id: 'reimport-copy' });
    state.logs.push({ ...structuredClone(state.logs[0]), id: 'second-session', date: '2026-10-02' });
    const result = await request({ type: 'createGoal', title: 'One step', target: 1, startDate: '2026-10-01', endDate: '2026-10-31', shared: false });
    expect(result.dashboard.goals[0].progress).toBe(1);
    expect(result.dashboard.me.stats?.completedWorkouts).toBe(2);
  });
  it('defaults stats private while individually shared goals/posts remain visible, and removal revokes all', async () => {
    seedLogs(); await inviteAndAccept();
    await db.collection('users').updateOne({ _id: alice.email }, { $set: { name: 'Updated Alice' } });
    await request({ type: 'createGoal', title: 'Public goal', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: true });
    await request({ type: 'createGoal', title: 'Private goal', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: false });
    await request({ type: 'shareWorkout', workoutId: 'workout-1' }); user = bob;
    let dashboard = (await request()).dashboard;
    expect(dashboard.friends[0]).toMatchObject({ name: 'Updated Alice', stats: null, sharing: false });
    expect(dashboard.goals).toHaveLength(1); expect(dashboard.goals[0].progress).toBe(1);
    expect(dashboard.posts).toHaveLength(1); expect(dashboard.posts[0].detail).toBe('1 series completadas · 42 min');
    expect(JSON.stringify(dashboard)).not.toContain('SECRET EXERCISE'); expect(JSON.stringify(dashboard)).not.toContain('"weight":123');
    user = alice; await request({ type: 'setSharing', sharing: true }); user = bob;
    expect((await request()).dashboard.friends[0].stats?.completedWorkouts).toBe(1);
    const postId = dashboard.posts[0].id;
    await request({ type: 'removeFriend', email: alice.email }); dashboard = (await request()).dashboard;
    expect(dashboard.friends).toEqual([]); expect(dashboard.posts).toEqual([]); expect(dashboard.goals).toEqual([]);
    expect((await request({ type: 'cheer', postId })).statusCode).toBe(404);
  });
  it('limits goals atomically to ten and only deletes own goals', async () => {
    seedLogs();
    const action = { type: 'createGoal', title: 'Goal', target: 4, startDate: '2026-10-01', endDate: '2026-10-31', shared: false };
    for (let index = 0; index < 10; index++) expect((await request(action)).statusCode).toBe(200);
    expect((await request(action)).statusCode).toBe(409);
    const goalId = (await request()).dashboard.goals[0].id;
    user = bob; expect((await request({ type: 'deleteGoal', goalId })).statusCode).toBe(404);
    user = alice; expect((await request({ type: 'deleteGoal', goalId })).dashboard.goals).toHaveLength(9);
  });
  it('validates earned badges and server-owned completed workouts, with replay idempotence', async () => {
    seedLogs(bob.email);
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1', completed: true })).statusCode).toBe(400);
    expect((await request({ type: 'shareBadge', badgeId: 'first-workout', earned: true })).statusCode).toBe(400);
    seedLogs();
    expect((await request({ type: 'shareBadge', badgeId: 'workouts-50' })).statusCode).toBe(400);
    await request({ type: 'shareBadge', badgeId: 'first-workout' }); await request({ type: 'shareBadge', badgeId: 'first-workout' });
    await request({ type: 'shareWorkout', workoutId: 'workout-1' }); await request({ type: 'shareWorkout', workoutId: 'workout-1' });
    expect((await request()).dashboard.posts).toHaveLength(2);
  });
  it('one cheer per user; DTOs never expose cheer email arrays; only owner deletes posts', async () => {
    seedLogs(); await inviteAndAccept();
    const postId = (await request({ type: 'shareWorkout', workoutId: 'workout-1' })).dashboard.posts[0].id;
    user = stranger; expect((await request({ type: 'cheer', postId })).statusCode).toBe(404);
    user = bob;
    await Promise.all([request({ type: 'cheer', postId }), request({ type: 'cheer', postId })]);
    const post = (await request()).dashboard.posts[0]; expect(post.cheers).toBe(1); expect(post.cheered).toBe(true); expect(post).not.toHaveProperty('cheerers');
    expect((await request({ type: 'deletePost', postId })).statusCode).toBe(404);
    user = alice; expect((await request({ type: 'deletePost', postId })).dashboard.posts).toEqual([]);
  });
  it('ignores malformed persisted state rather than computing achievements from it', async () => {
    db.collection('userStates').documents.set(alice.email, { _id: alice.email, state: { logs: [{ completed: true }] } });
    expect((await request()).dashboard.me.stats?.completedWorkouts).toBe(0);
    expect((await request({ type: 'shareBadge', badgeId: 'first-workout' })).statusCode).toBe(400);
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1' })).statusCode).toBe(400);
  });
  it('rejects incomplete, empty and future workouts regardless of client claims', async () => {
    seedLogs();
    const workout = db.collection('userStates').documents.get(alice.email)!.state.logs[0];
    workout.completed = false;
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1', completed: true })).statusCode).toBe(400);
    workout.completed = true; workout.exercises[0].sets[0].done = false;
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1' })).statusCode).toBe(400);
    workout.exercises[0].sets[0].done = true; workout.date = '2026-10-09';
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1' })).statusCode).toBe(400);
  });
  it('bounds feed to 50 and graph processing to 100 relationships', async () => {
    for (let index = 0; index < 60; index++) {
      await db.collection('socialPosts').insertOne({ _id: `post-${index}`, ownerEmail: alice.email, kind: 'workout', title: 'Workout', detail: 'Summary', createdAt: new Date(Date.now() + index * 1000), cheerers: [] });
    }
    for (let index = 0; index < 110; index++) {
      const email = `friend${index}@example.invalid`;
      await db.collection('socialRelationships').insertOne({ _id: socialPairId(alice.email, email), invitationId: `invitation-${index}`, from: alice, toEmail: email, members: [alice.email, email], state: 'accepted', updatedAt: new Date(), createdAt: new Date(), emailStatus: 'unconfigured' });
    }
    const dashboard = (await request()).dashboard;
    expect(dashboard.posts).toHaveLength(50); expect(dashboard.posts[0].id).toBe('post-59'); expect(dashboard.friends).toHaveLength(100);
  });
});

describe('in-app invitations only', () => {
  it('stores no mail status and strips legacy mail fields from responses', async () => {
    const result = await request({ type: 'invite', email: ' BOB@EXAMPLE.INVALID ' });
    expect(result.statusCode).toBe(200);
    expect(result.dashboard.invitations[0].toEmail).toBe(bob.email);
    expect(result.dashboard).not.toHaveProperty('emailConfigured');
    const relationship = db.collection('socialRelationships').documents.get(socialPairId(alice.email, bob.email))!;
    expect(relationship).not.toHaveProperty('emailStatus');
    relationship.emailStatus = 'sent';
    expect((await request()).dashboard.invitations[0]).not.toHaveProperty('emailStatus');
    user = bob;
    expect((await request()).dashboard.invitations[0].direction).toBe('incoming');
    expect((await request({ type: 'accept', invitationId: result.dashboard.invitations[0].id })).dashboard.friends[0].email).toBe(alice.email);
  });
});

describe('exact registered-person lookup', () => {
  const lookup = (email: unknown, headers: Doc = {}) => request(undefined, 'GET', headers, { email });
  it('normalizes an exact email, returns only public AuthUser fields and does not search prefixes', async () => {
    Object.assign(db.collection('users').documents.get(bob.email)!, { passwordHash: 'secret', email: 'ignore@example.invalid' });
    expect((await lookup(' BOB@EXAMPLE.INVALID ')).body).toEqual({ userEmail: alice.email, people: [bob] });
    expect((await lookup('bo')).statusCode).toBe(400);
    expect((await lookup('bob2@example.invalid')).body).toEqual({ userEmail: alice.email, people: [] });
    expect((await lookup(alice.email)).body).toEqual({ userEmail: alice.email, people: [] });
  });
  it('finds legacy accounts without a Mongo user and invites them in-app', async () => {
    const email = 'kyani1278@gmail.com';
    expect((await lookup(email)).body).toEqual({ userEmail: alice.email, people: [{ email, name: 'Kyani' }] });
    expect((await request({ type: 'invite', email })).statusCode).toBe(200);
  });
  it.each(['', 'bad', ['bob@example.invalid', 'stranger@example.invalid'], 'bob@', 'bob@example.invalid\r\nInjected', '*', null])('rejects invalid exact query %j before DB access', async (email) => {
    expect((await lookup(email)).statusCode).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('applies authentication, required owner and expired access protections', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect((await lookup(bob.email)).statusCode).toBe(401);
    expect((await lookup(bob.email, { 'x-kyon-user-email': undefined })).statusCode).toBe(409);
    expect((await lookup(bob.email, { 'x-kyon-user-email': bob.email })).statusCode).toBe(409);
    expired = true; expect((await lookup(bob.email)).statusCode).toBe(402);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('atomically bounds distributed lookups to 30 per sender per minute with one-day expiry', async () => {
    const results = await Promise.all(Array.from({ length: 31 }, () => lookup(bob.email)));
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(30);
    expect(results.filter((result) => result.statusCode === 429)).toHaveLength(1);
    const quota = [...db.collection('socialInviteQuotas').documents.values()][0];
    expect(quota.count).toBe(30); expect(quota.expiresAt.getTime()).toBe(Date.now() + 86400000);
    user = stranger; expect((await lookup(bob.email)).statusCode).toBe(200);
    user = alice; vi.advanceTimersByTime(60000);
    expect((await lookup(bob.email)).statusCode).toBe(200);
    expect((await request({ type: 'invite', email: bob.email })).statusCode).toBe(200);
  });
  it('revalidates recipients on invite even after a successful selection', async () => {
    expect((await lookup(bob.email)).statusCode).toBe(200);
    db.collection('users').documents.delete(bob.email);
    expect((await request({ type: 'invite', email: bob.email })).body).toEqual({ message: 'No encontramos esa cuenta.' });
    expect(db.collection('socialRelationships').documents.size).toBe(0);
  });
});

describe('explicit workout snapshots and descriptions', () => {
  const detail = (postId: unknown, headers: Doc = {}) => request(undefined, 'GET', headers, { postId });
  async function publish(description?: string) {
    return (await request({ type: 'shareWorkout', workoutId: 'workout-1', ...(description === undefined ? {} : { description }) })).dashboard.posts[0];
  }
  it.each(['', ' ', 'x'.repeat(201), ['one', 'two'], 'bad\u0000id'])('rejects invalid detail ID %j before Mongo', async (postId) => {
    expect((await detail(postId)).statusCode).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('rejects email/detail ambiguity and repeats before Mongo', async () => {
    for (const query of [{ email: bob.email, postId: 'post' }, { email: [bob.email, bob.email] }, { postId: ['post', 'post'] }]) {
      expect((await request(undefined, 'GET', {}, query)).statusCode).toBe(400);
    }
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('protects detail with session, matching owner and active access', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect((await detail('post')).statusCode).toBe(401);
    expect((await detail('post', { 'x-kyon-user-email': undefined })).statusCode).toBe(409);
    expect((await detail('post', { 'x-kyon-user-email': bob.email })).statusCode).toBe(409);
    expired = true; expect((await detail('post')).statusCode).toBe(402);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('returns exactly one immutable workout with original units, bodyweight and unfinished sets, never raw fields in feed', async () => {
    seedLogs(); await inviteAndAccept();
    const state = db.collection('userStates').documents.get(alice.email)!.state;
    state.logs[0].exercises[0].sets.push({ done: false, reps: 3, weight: 12.75, unit: 'lb' }, { done: true, reps: 8, weight: 0, unit: 'kg' });
    state.logs.push({ ...structuredClone(state.logs[0]), id: 'private-log', date: '2026-10-02', title: 'PRIVATE OTHER LOG' });
    const original = structuredClone(state.logs[0]);
    const post = await publish('  First\nline\ttext\r\n<script>  ');
    expect(post).toMatchObject({ description: 'First\nline\ttext\r\n<script>', hasWorkoutDetails: true });
    expect(post).not.toHaveProperty('workoutSnapshot');
    expect(JSON.stringify(post)).not.toContain('SECRET EXERCISE');
    state.logs[0].title = 'Changed'; state.logs[0].exercises[0].sets[0].weight = 999;
    await publish('Replacement description');
    user = bob;
    db.collection.mockClear();
    const response = await detail(post.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toContain('no-store');
    expect((response.body as SocialWorkoutDetail)).toEqual({ userEmail: bob.email, post: { ...post, owner: alice }, workout: original });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE OTHER LOG');
    expect(db.collection.mock.calls.some(([name]) => name === 'userStates')).toBe(false);
    user = alice;
    expect((await detail(post.id)).statusCode).toBe(200);
    await request({ type: 'deletePost', postId: post.id });
    const replacement = await publish('Replacement description');
    expect((await detail(replacement.id)).body).toMatchObject({ post: { description: 'Replacement description' }, workout: { title: 'Changed' } });
  });
  it('denies strangers, pending and removed friends; deleted posts stay unavailable', async () => {
    seedLogs(); const post = await publish();
    user = stranger; expect((await detail(post.id)).statusCode).toBe(404);
    user = alice; await request({ type: 'invite', email: bob.email });
    user = bob; expect((await detail(post.id)).statusCode).toBe(404);
    const invitation = (await request()).dashboard.invitations[0];
    await request({ type: 'accept', invitationId: invitation.id });
    expect((await detail(post.id)).statusCode).toBe(200);
    await request({ type: 'removeFriend', email: alice.email });
    expect((await detail(post.id)).statusCode).toBe(404);
    user = alice; await request({ type: 'deletePost', postId: post.id });
    expect((await detail(post.id)).statusCode).toBe(404);
  });
  it('never enriches legacy posts, and badges have no workout detail', async () => {
    seedLogs(); const post = await publish();
    const stored = db.collection('socialPosts').documents.get(post.id)!;
    delete stored.workoutSnapshot; delete stored.description;
    expect((await request()).dashboard.posts[0]).toMatchObject({ description: '', hasWorkoutDetails: false });
    await publish('New consent cannot overwrite old post');
    db.collection.mockClear();
    const response = await detail(post.id);
    expect(response.statusCode).toBe(410);
    expect(response.body).toEqual({ message: 'Esta publicación antigua no incluye el detalle. El autor puede eliminarla y volver a compartir el entrenamiento.' });
    expect(db.collection.mock.calls.some(([name]) => name === 'userStates')).toBe(false);
    const badge = (await request({ type: 'shareBadge', badgeId: 'first-workout', description: ' My badge ' })).dashboard.posts.find((entry) => entry.kind === 'badge')!;
    expect(badge).toMatchObject({ description: 'My badge', hasWorkoutDetails: false });
    expect((await detail(badge.id)).statusCode).toBe(400);
    expect(db.collection('socialPosts').documents.get(badge.id)).not.toHaveProperty('workoutSnapshot');
    await request({ type: 'shareBadge', badgeId: 'first-workout', description: 'Changed' });
    expect((await request()).dashboard.posts.find((entry) => entry.id === badge.id)?.description).toBe('My badge');
  });
  it.each([null, 1, {}, 'x'.repeat(501), 'bad\u0000', 'bad\u000b', 'bad\u007f', 'bad\u0085'])('rejects invalid descriptions %j before Mongo for both share actions', async (description) => {
    for (const action of [{ type: 'shareWorkout', workoutId: 'workout-1' }, { type: 'shareBadge', badgeId: 'first-workout' }]) {
      expect((await request({ ...action, description })).statusCode).toBe(400);
    }
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('allows omitted descriptions and trimmed text at the exact limit', async () => {
    seedLogs(); expect((await publish()).description).toBe('');
    const badge = (await request({ type: 'shareBadge', badgeId: 'first-workout', description: `  ${'x'.repeat(500)}  ` })).dashboard.posts.find((entry) => entry.kind === 'badge')!;
    expect(badge.description).toHaveLength(500);
  });
  it('rejects oversized snapshots before writing, with no truncation', async () => {
    seedLogs();
    db.collection('userStates').documents.get(alice.email)!.state.logs[0].title = 'x'.repeat(500 * 1024);
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1' })).statusCode).toBe(400);
    expect(db.collection('socialPosts').documents.size).toBe(0);
  });
  it.each([{ duration: -1 }, { date: '2026-02-30' }])('rejects invalid persisted workouts %j and invalid stored snapshots', async (override) => {
    seedLogs(); const post = await publish();
    Object.assign(db.collection('userStates').documents.get(alice.email)!.state.logs[0], override);
    expect((await request({ type: 'shareWorkout', workoutId: 'workout-1' })).statusCode).toBe(400);
    Object.assign(db.collection('socialPosts').documents.get(post.id)!.workoutSnapshot, override);
    expect((await request()).dashboard.posts[0].hasWorkoutDetails).toBe(false);
    expect((await detail(post.id)).statusCode).toBe(410);
  });
});
