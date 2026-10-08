import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DependencyList, EffectCallback, ReactElement } from 'react';
import type { AppState, AuthUser, Routine, WorkoutLog } from '../src/types';

// A tiny hook runner exercises App's actual handlers without a DOM, network, or testing-library dependency.
const hookRuntime = vi.hoisted(() => {
  type Slot = { value?: unknown; current?: unknown; deps?: DependencyList; cleanup?: () => void };
  type Runner = { slots: Slot[]; cursor: number; dirty: boolean; effects: Array<{ index: number; callback: EffectCallback }> };
  const runtime: { current: Runner | null } = { current: null };
  const same = (a: DependencyList | undefined, b: DependencyList | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (callback: EffectCallback, deps?: DependencyList) => {
    const runner = runtime.current!;
    const index = runner.cursor++;
    const previous = runner.slots[index];
    if (!previous || !same(previous.deps, deps)) {
      runner.slots[index] = { deps, cleanup: previous?.cleanup };
      runner.effects.push({ index, callback });
    }
  };
  return { runtime, effect };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const runner = hookRuntime.runtime.current!;
      const index = runner.cursor++;
      if (!(index in runner.slots)) runner.slots[index] = { value: typeof initial === 'function' ? (initial as () => T)() : initial };
      const slot = runner.slots[index];
      return [slot.value as T, (next: T | ((old: T) => T)) => {
        slot.value = typeof next === 'function' ? (next as (old: T) => T)(slot.value as T) : next;
        runner.dirty = true;
      }];
    },
    useRef<T>(initial: T) {
      const runner = hookRuntime.runtime.current!;
      const index = runner.cursor++;
      if (!(index in runner.slots)) runner.slots[index] = { current: initial };
      return runner.slots[index] as { current: T };
    },
    useMemo<T>(factory: () => T, deps: DependencyList) {
      const runner = hookRuntime.runtime.current!;
      const index = runner.cursor++;
      const previous = runner.slots[index];
      if (!previous?.deps || !deps.every((value, i) => Object.is(value, previous.deps?.[i])) || deps.length !== previous.deps.length) {
        runner.slots[index] = { value: factory(), deps };
      }
      return runner.slots[index].value as T;
    },
    useEffect: hookRuntime.effect,
    useLayoutEffect: hookRuntime.effect,
  };
});

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return {
    ...actual,
    getRemoteSession: vi.fn(), getRemoteState: vi.fn(), mutateRemoteState: vi.fn(), bootstrapRemoteState: vi.fn(),
    loginRemote: vi.fn(), registerRemote: vi.fn(), logoutRemote: vi.fn(), changePasswordRemote: vi.fn(),
    getSocialDashboard: vi.fn(), actSocial: vi.fn(),
    getSocialWorkoutDetail: vi.fn(),
  };
});

import App from '../src/App';
import { actSocial, ApiError, bootstrapRemoteState, changePasswordRemote, getRemoteSession, getRemoteState, getSocialDashboard, getSocialWorkoutDetail, loginRemote, logoutRemote, mutateRemoteState } from '../src/api';
import type { SocialDashboard, SocialWorkoutDetail } from '../src/socialTypes';
import { SESSION_PREVIEW_KEY } from '../src/sessionPreview';
import { createInitialState } from '../src/data';
import { applySyncMutation, syncMigrationBackupKey, syncOutboxKey } from '../src/syncState';

const A: AuthUser = { name: 'Cuenta A', email: 'audit-a@example.invalid' };
const B: AuthUser = { name: 'Cuenta B', email: 'audit-b@example.invalid' };
const access = { status: 'active' as const, trialEndsAt: null, trialDaysRemaining: 0, isAdmin: false };
const socialFixture = (user = A): SocialDashboard => ({ userEmail: user.email, me: { ...user, sharing: false, stats: null }, friends: [], invitations: [], goals: [], posts: [] });
const cacheKey = (user: AuthUser) => `kyon-state-cache-v1:${user.email}`;
const draftKey = (user: AuthUser) => `kyon-active-workout-v1:${user.email}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function state(name: string): AppState {
  return {
    ...createInitialState(),
    routine: { id: `routine-${name}`, name, days: [{ id: `day-${name}`, dayOfWeek: 4, title: name, focus: '', color: '#aaa', duration: 45,
      exercises: [{ id: `exercise-${name}`, name: 'Press', sets: 2, reps: '10', rest: 90 }] }] },
  };
}

function log(): WorkoutLog {
  return { id: 'audit-log-A', date: '2026-10-08', routineDayId: 'day-A', title: 'A', duration: 30, completed: true,
    exercises: [{ exerciseId: 'exercise-A', exerciseName: 'Press', sets: [{ weight: 10, reps: 10, done: true, unit: 'kg' }] }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('quota exceeded'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

type Element = ReactElement<Record<string, unknown>>;
function findElement(tree: unknown, name: string): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findElement(child, name); if (found) return found; }
  }
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return undefined;
  const element = tree as Element;
  if (typeof element.type === 'function' && element.type.name === name) return element;
  return findElement(element.props.children, name);
}

const runners: Array<{ dispose: () => void }> = [];
function mountApp() {
  const runner = {
    slots: [] as Array<{ value?: unknown; current?: unknown; deps?: DependencyList; cleanup?: () => void }>,
    cursor: 0, dirty: true, effects: [] as Array<{ index: number; callback: EffectCallback }>, tree: null as unknown,
    render() {
      hookRuntime.runtime.current = runner;
      runner.cursor = 0; runner.dirty = false;
      try { runner.tree = App(); } finally { hookRuntime.runtime.current = null; }
      for (const { index, callback } of runner.effects.splice(0)) {
        runner.slots[index].cleanup?.();
        const cleanup = callback();
        runner.slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    },
    async settle() {
      for (let index = 0; index < 80; index += 1) {
        await Promise.resolve();
        if (runner.dirty) runner.render();
      }
    },
    props<T>(name: string): T {
      const element = findElement(runner.tree, name);
      if (!element) throw new Error(`Component ${name} was not rendered`);
      return element.props as T;
    },
    dispose() { for (const slot of runner.slots) slot.cleanup?.(); },
  };
  runners.push(runner); runner.render();
  return runner;
}

function mountComponent(element: Element) {
  const Component = element.type as (props: Record<string, unknown>) => unknown;
  const runner = {
    slots: [] as Array<{ value?: unknown; current?: unknown; deps?: DependencyList; cleanup?: () => void }>,
    cursor: 0, dirty: true, effects: [] as Array<{ index: number; callback: EffectCallback }>, tree: null as unknown,
    render() {
      hookRuntime.runtime.current = runner;
      runner.cursor = 0; runner.dirty = false;
      try { runner.tree = Component(element.props); } finally { hookRuntime.runtime.current = null; }
      for (const { index, callback } of runner.effects.splice(0)) {
        runner.slots[index].cleanup?.();
        const cleanup = callback();
        runner.slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    },
    async settle() {
      for (let index = 0; index < 80; index += 1) {
        await Promise.resolve();
        if (runner.dirty) runner.render();
      }
    },
    dispose() { for (const slot of runner.slots) slot.cleanup?.(); },
  };
  runner.render();
  return runner;
}

function textContent(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join(' ');
  if (tree && typeof tree === 'object' && 'props' in tree) return textContent((tree as Element).props.children);
  return '';
}

let storage: MemoryStorage;
let owner: AuthUser;
let server: Record<string, AppState>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  storage = new MemoryStorage(); owner = A;
  server = { [A.email]: state('A'), [B.email]: state('B') };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', { scrollTo: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    location: { search: '' },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled'); }));
  vi.mocked(getRemoteSession).mockResolvedValue({ user: A, access });
  vi.mocked(getRemoteState).mockImplementation(async ({ userEmail }) => ({ state: clone(server[userEmail]), revision: 1, userEmail }));
  vi.mocked(loginRemote).mockImplementation(async (email) => { owner = email === B.email ? B : A; return { user: owner, access }; });
  vi.mocked(logoutRemote).mockResolvedValue({ ok: true });
  vi.mocked(changePasswordRemote).mockResolvedValue({ ok: true });
  vi.mocked(getSocialDashboard).mockImplementation(async () => socialFixture(owner));
  vi.mocked(actSocial).mockImplementation(async () => socialFixture(owner));
  vi.mocked(mutateRemoteState).mockImplementation(async (mutation, { userEmail }) => {
    if (userEmail !== owner.email) throw new ApiError('Owner mismatch', 403, undefined, 'SESSION_OWNER_MISMATCH');
    server[userEmail] = applySyncMutation(server[userEmail], mutation);
    return { state: clone(server[userEmail]), revision: 2, userEmail };
  });
  vi.mocked(bootstrapRemoteState).mockImplementation(async (candidate, { userEmail }) => ({ state: candidate, revision: 1, userEmail }));
});

afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();
});

describe('App synchronization integration (offline hook runner)', () => {
  it('renders a cached dashboard immediately after refresh but does not sync before server authentication', async () => {
    sessionStorage.setItem(SESSION_PREVIEW_KEY, JSON.stringify({ user: A, access, savedAt: Date.now() }));
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    const pending = deferred<Awaited<ReturnType<typeof getRemoteSession>>>();
    vi.mocked(getRemoteSession).mockReturnValueOnce(pending.promise);
    const app = mountApp();
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(A.email);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('A');
    app.props<{ onToggleUnit: () => void }>('Topbar').onToggleUnit(); await app.settle();
    expect(getRemoteState).not.toHaveBeenCalled(); expect(mutateRemoteState).not.toHaveBeenCalled();
    pending.resolve({ user: A, access }); await app.settle();
    expect(getRemoteState).toHaveBeenCalledWith(expect.objectContaining({ userEmail: A.email }));
  });
  it('shows login instantly without a cached session and clears a rejected cached identity', async () => {
    const pending = deferred<Awaited<ReturnType<typeof getRemoteSession>>>();
    vi.mocked(getRemoteSession).mockReturnValueOnce(pending.promise);
    const empty = mountApp();
    expect(findElement(empty.tree, 'LoginScreen')).toBeDefined();
    empty.dispose();
    sessionStorage.setItem(SESSION_PREVIEW_KEY, JSON.stringify({ user: A, access, savedAt: Date.now() }));
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    vi.mocked(getRemoteSession).mockRejectedValueOnce(new ApiError('No session', 401));
    const app = mountApp(); await app.settle();
    expect(findElement(app.tree, 'LoginScreen')).toBeDefined();
    expect(sessionStorage.getItem(SESSION_PREVIEW_KEY)).toBeNull();
    expect(getRemoteState).not.toHaveBeenCalled();
  });
  it('never adopts A cached state for a server session that belongs to B', async () => {
    sessionStorage.setItem(SESSION_PREVIEW_KEY, JSON.stringify({ user: A, access, savedAt: Date.now() }));
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    vi.mocked(getRemoteSession).mockResolvedValueOnce({ user: B, access }); owner = B;
    const app = mountApp(); await app.settle();
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('B');
    expect(JSON.parse(sessionStorage.getItem(SESSION_PREVIEW_KEY)!).user.email).toBe(B.email);
  });
  it('reuses the calendar modal for a shared snapshot and clears it when logging out', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'amigos') => void }>('Sidebar').onNavigate('amigos'); await app.settle();
    const detail: SocialWorkoutDetail = { userEmail: A.email, post: { id: 'post-id', owner: B, kind: 'workout', title: 'B shared workout', detail: '30 min', description: 'My progress', hasWorkoutDetails: true, createdAt: '2026-10-08T12:00:00Z', cheers: 0, cheered: false }, workout: { ...log(), id: 'shared-B-log' } };
    vi.mocked(getSocialWorkoutDetail).mockResolvedValueOnce(detail);
    const view = app.props<{ detail: (postId: string) => Promise<SocialWorkoutDetail>; onViewWorkout: (detail: SocialWorkoutDetail, trigger: HTMLElement | null) => void }>('FriendsView');
    const result = await view.detail('post-id');
    expect(getSocialWorkoutDetail).toHaveBeenCalledWith('post-id', expect.objectContaining({ userEmail: A.email }));
    view.onViewWorkout(result, null); await app.settle();
    expect(app.props<{ logs: WorkoutLog[]; description: string; ownerName: string }>('WorkoutHistoryModal')).toMatchObject({ logs: [detail.workout], description: 'My progress', ownerName: B.name });
    app.props<{ onLogout: () => void }>('Sidebar').onLogout(); await app.settle();
    expect(findElement(app.tree, 'WorkoutHistoryModal')).toBeUndefined();
  });
  it('offers community after finishing without automatically publishing workout data', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onStartWorkout: () => void }>('Topbar').onStartWorkout(); await app.settle();
    expect(app.props<{ onFinish: (log: WorkoutLog) => boolean }>('WorkoutSession').onFinish(log())).toBe(true);
    await app.settle();
    app.props<{ onCommunity: () => void }>('CompletionModal').onCommunity(); await app.settle();
    expect(app.props<{ user: AuthUser }>('FriendsView').user.email).toBe(A.email);
    expect(actSocial).not.toHaveBeenCalled();
  });
  it('opens Amigos from a direct link and preserves the destination after login', async () => {
    window.location.search = '?view=amigos';
    vi.mocked(getRemoteSession).mockRejectedValueOnce(new ApiError('Login required', 401));
    const app = mountApp(); await app.settle();
    await app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(A.email, 'synthetic', true);
    await app.settle();
    expect(app.props<{ user: AuthUser }>('FriendsView').user.email).toBe(A.email);
  });

  it('binds Amigos requests to the session and forwards unmount cancellation', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'amigos') => void }>('Sidebar').onNavigate('amigos'); await app.settle();
    const view = app.props<{ load: (signal?: AbortSignal) => Promise<SocialDashboard>; act: (action: { type: 'invite'; email: string }) => Promise<SocialDashboard> }>('FriendsView');
    const pending = deferred<SocialDashboard>();
    vi.mocked(getSocialDashboard).mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const loading = view.load(controller.signal);
    expect(getSocialDashboard).toHaveBeenCalledWith(expect.objectContaining({ userEmail: A.email }));
    controller.abort();
    expect(vi.mocked(getSocialDashboard).mock.calls.at(-1)?.[0].signal?.aborted).toBe(true);
    pending.resolve(socialFixture()); await loading;
    await view.act({ type: 'invite', email: B.email });
    expect(actSocial).toHaveBeenCalledWith({ type: 'invite', email: B.email }, expect.objectContaining({ userEmail: A.email }));
  });

  it('rejects a late social response after changing accounts', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'amigos') => void }>('Sidebar').onNavigate('amigos'); await app.settle();
    const pending = deferred<SocialDashboard>();
    vi.mocked(getSocialDashboard).mockReturnValueOnce(pending.promise);
    const response = app.props<{ load: () => Promise<SocialDashboard> }>('FriendsView').load();
    const rejected = expect(response).rejects.toMatchObject({ name: 'AbortError' });
    app.props<{ onLogout: () => void }>('Sidebar').onLogout(); await app.settle();
    await app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(B.email, 'synthetic', true); await app.settle();
    pending.resolve(socialFixture(A)); await rejected;
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
  });

  it('honors expired access returned by the social API', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'amigos') => void }>('Sidebar').onNavigate('amigos'); await app.settle();
    vi.mocked(getSocialDashboard).mockRejectedValueOnce(new ApiError('Expired', 402, { ...access, status: 'expired' }));
    await expect(app.props<{ load: () => Promise<SocialDashboard> }>('FriendsView').load()).rejects.toMatchObject({ status: 402 });
    await app.settle();
    expect(findElement(app.tree, 'TrialExpiredScreen')).toBeDefined();
  });
  it('shows cached data while the initial remote GET is still pending', async () => {
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    const remote = deferred<Awaited<ReturnType<typeof getRemoteState>>>();
    vi.mocked(getRemoteState).mockReturnValue(remote.promise);
    const app = mountApp(); await app.settle();
    expect(app.props<{ user: AuthUser }>('Sidebar').user).toEqual(A);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('A');
  });

  it('does not adopt the old GET after logout and login as another user', async () => {
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    const old = deferred<Awaited<ReturnType<typeof getRemoteState>>>();
    vi.mocked(getRemoteState).mockImplementation(({ userEmail }) => userEmail === A.email
      ? old.promise : Promise.resolve({ state: state('B'), revision: 1, userEmail: B.email }));
    const app = mountApp(); await app.settle();
    app.props<{ onLogout: () => void }>('Sidebar').onLogout(); await app.settle();
    const login = app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(B.email, 'synthetic', true);
    await app.settle(); await login;
    old.resolve({ state: state('old-A'), revision: 5, userEmail: A.email }); await app.settle();
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('B');
    expect(JSON.parse(storage.getItem(cacheKey(A))!).routine.name).toBe('A');
  });

  it('keeps A pending work, skips its unsent PATCH, and ignores its late 402 after B login', async () => {
    const first = deferred<Awaited<ReturnType<typeof mutateRemoteState>>>();
    vi.mocked(mutateRemoteState).mockReturnValue(first.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onToggleUnit: () => void }>('Topbar').onToggleUnit(); await app.settle();
    app.props<{ onStartWorkout: () => void }>('Topbar').onStartWorkout(); await app.settle();
    expect(app.props<{ onFinish: (log: WorkoutLog) => boolean }>('WorkoutSession').onFinish(log())).toBe(true);
    await app.settle();
    app.props<{ onLogout: () => void }>('Sidebar').onLogout(); await app.settle();
    const login = app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(B.email, 'synthetic', true);
    await app.settle(); await login;
    first.reject(new ApiError('Old A trial expired', 402, { ...access, status: 'expired' })); await app.settle();
    expect(mutateRemoteState).toHaveBeenCalledTimes(1);
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('B');
    expect(JSON.parse(storage.getItem(syncOutboxKey(A.email))!).pending).toHaveLength(2);
  });

  it('retains the workout draft and active session if durable storage rejects finishing', async () => {
    const app = mountApp(); await app.settle();
    app.props<{ onStartWorkout: () => void }>('Topbar').onStartWorkout(); await app.settle();
    storage.setItem(draftKey(A), 'synthetic draft backup');
    storage.failWrites = true;
    expect(app.props<{ onFinish: (log: WorkoutLog) => boolean }>('WorkoutSession').onFinish(log())).toBe(false);
    await app.settle();
    expect(findElement(app.tree, 'WorkoutSession')).toBeDefined();
    expect(findElement(app.tree, 'CompletionModal')).toBeUndefined();
    expect(storage.getItem(draftKey(A))).toBe('synthetic draft backup');
    expect(mutateRemoteState).not.toHaveBeenCalled();
  });

  it('refuses a save during bootstrap instead of sending an uninitialized PATCH', async () => {
    const remote = deferred<Awaited<ReturnType<typeof getRemoteState>>>();
    vi.mocked(getRemoteState).mockReturnValue(remote.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onStartWorkout: () => void }>('Topbar').onStartWorkout(); await app.settle();
    app.props<{ onSave: (routine: Routine) => void }>('RoutineBuilderModal').onSave(state('manual').routine);
    await app.settle();
    expect(mutateRemoteState).not.toHaveBeenCalled();
    expect(storage.getItem(syncOutboxKey(A.email))).toBeNull();
    remote.resolve({ state: null, revision: null, userEmail: A.email }); await app.settle();
    expect(bootstrapRemoteState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bootstrapRemoteState).mock.calls[0][0].routine.days).toEqual([]);
  });

  it('does not adopt a late migration response after logout/login B', async () => {
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    const migration = deferred<Awaited<ReturnType<typeof bootstrapRemoteState>>>();
    vi.mocked(getRemoteState).mockImplementation(async ({ userEmail }) => ({ state: userEmail === A.email ? null : state('B'), revision: userEmail === A.email ? null : 1, userEmail }));
    vi.mocked(bootstrapRemoteState).mockReturnValue(migration.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onMigrate: () => void }>('MigrationScreen').onMigrate(); await app.settle();
    app.props<{ onLogout: () => void }>('MigrationScreen').onLogout(); await app.settle();
    const login = app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(B.email, 'synthetic', true);
    await app.settle(); await login;
    migration.resolve({ state: state('migrated-A'), revision: 1, userEmail: A.email }); await app.settle();
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('B');
    expect(JSON.parse(storage.getItem(syncMigrationBackupKey(A.email))!).routine.name).toBe('A');
  });

  it('backs up the original cache before adopting a migration conflict response', async () => {
    const original = state('Local'); original.logs = [log()];
    storage.setItem(cacheKey(A), JSON.stringify(original));
    let reads = 0;
    vi.mocked(getRemoteState).mockImplementation(async () => ({ state: ++reads === 1 ? null : state('Remote'), revision: reads === 1 ? null : 1, userEmail: A.email }));
    vi.mocked(bootstrapRemoteState).mockRejectedValue(new ApiError('Already bootstrapped', 409));
    const app = mountApp(); await app.settle();
    app.props<{ onMigrate: () => void }>('MigrationScreen').onMigrate(); await app.settle();
    expect(JSON.parse(storage.getItem(syncMigrationBackupKey(A.email))!)).toEqual(original);
    expect(app.props<{ state: AppState }>('Dashboard').state.routine.name).toBe('Remote');
  });

  it('serializes an actual logout handler before the next login request', async () => {
    const pendingLogout = deferred<{ ok: true }>();
    vi.mocked(logoutRemote).mockReturnValue(pendingLogout.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onLogout: () => void }>('Sidebar').onLogout(); await app.settle();
    const login = app.props<{ onLogin: typeof loginRemote }>('LoginScreen').onLogin(B.email, 'synthetic', true);
    await app.settle();
    expect(loginRemote).not.toHaveBeenCalled();
    pendingLogout.resolve({ ok: true }); await app.settle(); await login;
    expect(loginRemote).toHaveBeenCalledTimes(1);
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(B.email);
  });

  it('keeps payment activation manual while allowing a read-only access check and profile navigation', async () => {
    vi.mocked(getRemoteSession).mockResolvedValueOnce({ user: A, access: { ...access, status: 'expired' } });
    const app = mountApp(); await app.settle();
    const screen = mountComponent(findElement(app.tree, 'TrialExpiredScreen')!); await screen.settle();
    const text = textContent(screen.tree);
    expect(findElement(screen.tree, 'DataExportControls')).toBeUndefined();
    expect(getRemoteState).not.toHaveBeenCalled();
    expect(mutateRemoteState).not.toHaveBeenCalled();
    expect(bootstrapRemoteState).not.toHaveBeenCalled();
    expect(text).toContain('WhatsApp');
    expect(text).toContain('activaremos tu cuenta manualmente desde el panel de administración');
    expect(text).toContain('recarga la app');
    expect(text).toContain('Ya activaron mi cuenta, comprobar acceso');
    expect(app.props<{ onCheckAccess: () => Promise<boolean> }>('TrialExpiredScreen').onCheckAccess).toBeTypeOf('function');
    screen.dispose();
  });

  it('renders profile before the trial ends and delegates preference changes to the durable queue', async () => {
    vi.mocked(getRemoteSession).mockResolvedValueOnce({ user: A, access: { ...access, status: 'trial', trialDaysRemaining: 7, trialEndsAt: '2026-10-15T12:00:00Z' } });
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'perfil') => void }>('Sidebar').onNavigate('perfil'); await app.settle();
    const profile = app.props<{ user: AuthUser; access: typeof access; onSetUnit: (unit: 'kg' | 'lb') => void }>('ProfileView');
    expect(profile.user.email).toBe(A.email);
    expect(profile.access.status).toBe('trial');
    profile.onSetUnit('lb'); await app.settle();
    expect(mutateRemoteState).toHaveBeenCalledWith(expect.objectContaining({ type: 'setUnit', unit: 'lb' }), expect.objectContaining({ userEmail: A.email }));
  });

  it('allows an expired user to open profile without fetching or mutating workout state', async () => {
    vi.mocked(getRemoteSession).mockResolvedValueOnce({ user: A, access: { ...access, status: 'expired' } });
    const app = mountApp(); await app.settle();
    app.props<{ onProfile: () => void }>('TrialExpiredScreen').onProfile(); await app.settle();
    expect(app.props<{ access: typeof access }>('ProfileView').access.status).toBe('expired');
    expect(app.props<{ restricted: boolean }>('Sidebar').restricted).toBe(true);
    expect(getRemoteState).not.toHaveBeenCalled();
    expect(mutateRemoteState).not.toHaveBeenCalled();
  });

  it('does not activate an expired account when the server still reports expired', async () => {
    vi.mocked(getRemoteSession).mockResolvedValue({ user: A, access: { ...access, status: 'expired' } });
    const app = mountApp(); await app.settle();
    expect(await app.props<{ onCheckAccess: () => Promise<boolean> }>('TrialExpiredScreen').onCheckAccess()).toBe(false);
    await app.settle();
    expect(findElement(app.tree, 'TrialExpiredScreen')).toBeDefined();
    expect(getRemoteState).not.toHaveBeenCalled();
    expect(mutateRemoteState).not.toHaveBeenCalled();
  });

  it('returns to the app only after the server confirms admin activation', async () => {
    vi.mocked(getRemoteSession).mockResolvedValueOnce({ user: A, access: { ...access, status: 'expired' } });
    const app = mountApp(); await app.settle();
    expect(await app.props<{ onCheckAccess: () => Promise<boolean> }>('TrialExpiredScreen').onCheckAccess()).toBe(true);
    await app.settle();
    expect(app.props<{ user: AuthUser }>('Sidebar').user.email).toBe(A.email);
    expect(findElement(app.tree, 'TrialExpiredScreen')).toBeUndefined();
  });

  it('waits for password-change acknowledgement before clearing the local session', async () => {
    const pending = deferred<{ ok: true }>();
    vi.mocked(changePasswordRemote).mockReturnValueOnce(pending.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'perfil') => void }>('Sidebar').onNavigate('perfil'); await app.settle();
    const changing = app.props<{ onChangePassword: (current: string, next: string) => Promise<void> }>('ProfileView').onChangePassword('fixture-current-123', 'fixture-next-456');
    await app.settle();
    expect(findElement(app.tree, 'ProfileView')).toBeDefined();
    expect(changePasswordRemote).toHaveBeenCalledWith('fixture-current-123', 'fixture-next-456', expect.objectContaining({ userEmail: A.email }));
    pending.resolve({ ok: true }); await changing; await app.settle();
    expect(findElement(app.tree, 'LoginScreen')).toBeDefined();
    expect(app.props<{ sessionNotice: string }>('LoginScreen').sessionNotice).toContain('Contraseña actualizada');
  });

  it('preserves a pre-outbox cached workout as a backup instead of deleting its only copy', async () => {
    const original = state('A'); original.logs = [log()];
    storage.setItem(cacheKey(A), JSON.stringify(original));
    const app = mountApp(); await app.settle();
    expect(JSON.parse(storage.getItem(syncMigrationBackupKey(A.email))!)).toEqual(original);
    // Unknown legacy differences are not uploaded automatically as new mutations.
    expect(mutateRemoteState).not.toHaveBeenCalled();
  });

  it('prevents duplicate migration POSTs before React has rendered the busy state', async () => {
    storage.setItem(cacheKey(A), JSON.stringify(state('A')));
    vi.mocked(getRemoteState).mockResolvedValue({ state: null, revision: null, userEmail: A.email });
    const response = deferred<Awaited<ReturnType<typeof bootstrapRemoteState>>>();
    vi.mocked(bootstrapRemoteState).mockReturnValue(response.promise);
    const app = mountApp(); await app.settle();
    const migrate = app.props<{ onMigrate: () => void }>('MigrationScreen').onMigrate;
    migrate(); migrate(); await app.settle();
    expect(bootstrapRemoteState).toHaveBeenCalledTimes(1);
  });

  it('provides the local export state only on ready Progress and forwards export errors to the toast', async () => {
    const app = mountApp(); await app.settle();
    expect(app.props<{ exportState?: AppState }>('Topbar').exportState).toBeUndefined();
    app.props<{ onNavigate: (page: 'progreso') => void }>('Sidebar').onNavigate('progreso'); await app.settle();
    const topbar = findElement(app.tree, 'Topbar')!;
    const renderTopbar = topbar.type as (props: Record<string, unknown>) => unknown;
    const controls = findElement(renderTopbar(topbar.props), 'DataExportControls');
    expect(controls?.props.state).toEqual(state('A'));
    (controls?.props.onError as (message: string) => void)('synthetic local export error'); await app.settle();
    expect(app.props<{ message: string }>('Toast').message).toBe('synthetic local export error');
    expect(mutateRemoteState).not.toHaveBeenCalled();
    expect(bootstrapRemoteState).not.toHaveBeenCalled();
  });

  it('does not render export controls while Progress is loading', async () => {
    const remote = deferred<Awaited<ReturnType<typeof getRemoteState>>>();
    vi.mocked(getRemoteState).mockReturnValue(remote.promise);
    const app = mountApp(); await app.settle();
    app.props<{ onNavigate: (page: 'progreso') => void }>('Sidebar').onNavigate('progreso'); await app.settle();
    const topbar = findElement(app.tree, 'Topbar')!;
    expect(topbar.props.exportState).toBeUndefined();
    const renderTopbar = topbar.type as (props: Record<string, unknown>) => unknown;
    expect(findElement(renderTopbar(topbar.props), 'DataExportControls')).toBeUndefined();
  });
});
