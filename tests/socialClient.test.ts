import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actSocial, ApiOwnershipError, ApiResponseError, findSocialPerson, getSocialDashboard, getSocialWorkoutDetail, STATE_OWNER_HEADER } from '../src/api';
import type { SocialWorkoutDetail } from '../src/socialTypes';
import type { SocialDashboard } from '../src/socialTypes';

const email = 'social-client@example.invalid';
const fixture = (): SocialDashboard => ({ userEmail: email, me: { email, name: 'Synthetic', sharing: false, stats: {
  completedWorkouts: 0, currentWeeklyStreak: 0, bestWeeklyStreak: 0, personalBests: 0, badges: [],
} }, friends: [], invitations: [], goals: [], posts: [] });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw Error('Network disabled'); })));
afterEach(() => vi.unstubAllGlobals());

describe('social client boundary', () => {
  const workoutDetail = (): SocialWorkoutDetail => ({ userEmail: email, post: { id: 'post-1', owner: { email: 'friend@example.invalid', name: 'Friend' }, kind: 'workout', title: 'Shared', detail: '30 min', description: 'Great session', hasWorkoutDetails: true, createdAt: '2026-10-08T12:00:00Z', cheers: 0, cheered: false }, workout: { id: 'log-1', title: 'Shared session', routineDayId: 'day-1', date: '2026-10-08', completed: true, duration: 30, exercises: [{ exerciseId: 'press', exerciseName: 'Press', sets: [{ unit: 'lb', weight: 40, reps: 10, done: true }] }] } });
  it('loads only the chosen post with owner-bound validation and preserves its units', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(workoutDetail()));
    const detail = await getSocialWorkoutDetail('post-1', { userEmail: email });
    expect(detail.workout.exercises[0].sets[0]).toEqual({ unit: 'lb', weight: 40, reps: 10, done: true });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/social?postId=post-1');
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(STATE_OWNER_HEADER)).toBe(email);
  });
  it('rejects mismatched posts, wrong owners and malformed workout details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(workoutDetail()));
    await expect(getSocialWorkoutDetail('other-post', { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...workoutDetail(), userEmail: 'other@example.invalid' }));
    await expect(getSocialWorkoutDetail('post-1', { userEmail: email })).rejects.toBeInstanceOf(ApiOwnershipError);
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...workoutDetail(), workout: { completed: true, exercises: null } }));
    await expect(getSocialWorkoutDetail('post-1', { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });
  it('looks up an exact email with owner validation and rejects an unrelated person', async () => {
    const person = { email: 'friend@example.invalid', name: 'Friend' };
    vi.mocked(fetch).mockResolvedValueOnce(json({ userEmail: email, people: [person] }));
    expect(await findSocialPerson(' FRIEND@EXAMPLE.INVALID ', { userEmail: email })).toEqual([person]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/social?email=friend%40example.invalid');
    vi.mocked(fetch).mockResolvedValueOnce(json({ userEmail: email, people: [{ ...person, email: 'other@example.invalid' }] }));
    await expect(findSocialPerson(person.email, { userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });
  it('rejects lookup responses after the authenticated owner changes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ userEmail: 'other@example.invalid', people: [] }));
    await expect(findSocialPerson('friend@example.invalid', { userEmail: email })).rejects.toBeInstanceOf(ApiOwnershipError);
  });
  it('loads private dashboard bound to the authenticated owner', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(fixture()));
    expect(await getSocialDashboard({ userEmail: email })).toEqual(fixture());
    const [path, init] = vi.mocked(fetch).mock.calls[0];
    expect(path).toBe('/api/social');
    expect(new Headers(init?.headers).get(STATE_OWNER_HEADER)).toBe(email);
    expect(init?.cache).toBe('no-store');
    expect(init?.credentials).toBe('same-origin');
  });
  it('uses POST with origin-protected JSON for invitations', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(fixture()));
    await actSocial({ type: 'invite', email: 'friend@example.invalid' }, { userEmail: email });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'invite', email: 'friend@example.invalid' });
  });
  it('rejects another owner in either response identity', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...fixture(), userEmail: 'other@example.invalid' }));
    await expect(getSocialDashboard({ userEmail: email })).rejects.toBeInstanceOf(ApiOwnershipError);
    const data = fixture(); data.me.email = 'other@example.invalid';
    vi.mocked(fetch).mockResolvedValueOnce(json(data));
    await expect(getSocialDashboard({ userEmail: email })).rejects.toBeInstanceOf(ApiOwnershipError);
  });
  it.each([
    null, { ...fixture(), friends: null }, { ...fixture(), posts: [{ id: 'x' }] },
    { ...fixture(), friends: [{ ...fixture().me, email: 'private@example.invalid', sharing: false }] },
    { ...fixture(), me: { ...fixture().me, stats: { ...fixture().me.stats, completedWorkouts: -1 } } },
    { ...fixture(), invitations: [{ id: 'x', from: { email, name: 'Synthetic' }, toEmail: email, createdAt: 'bad-date', direction: 'incoming', emailStatus: 'sent' }] },
  ])('rejects malformed social payload without replacing displayed state', async payload => {
    vi.mocked(fetch).mockResolvedValueOnce(json(payload));
    await expect(getSocialDashboard({ userEmail: email })).rejects.toBeInstanceOf(ApiResponseError);
  });
  it('does not issue a request after cancellation', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(getSocialDashboard({ userEmail: email, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
