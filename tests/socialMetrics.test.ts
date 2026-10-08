import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeSocialStats, goalProgress } from '../src/socialMetrics';
import type { SetLog, WorkoutLog } from '../src/types';

const set = (weight = 50, reps = 10, done = true, unit: SetLog['unit'] = 'kg'): SetLog => ({ weight, reps, done, unit });
const workout = (date: string, overrides: Partial<WorkoutLog> = {}): WorkoutLog => ({
  id: date, date, routineDayId: 'day-1', title: 'Training', duration: 30, completed: true,
  exercises: [{ exerciseId: 'exercise-1', exerciseName: 'Squat', sets: [set()] }], ...overrides,
});
const now = new Date('2026-10-08T12:00:00Z');
const stats = (logs: WorkoutLog[]) => computeSocialStats(logs, now);
const loaded = (date: string, sets: SetLog[], name = 'Squat', id = date) => workout(date, {
  exercises: [{ exerciseId: id, exerciseName: name, sets }],
});

afterEach(() => vi.useRealTimers());

describe('completed social workouts', () => {
  it('requires completion and at least one valid done set; bodyweight counts', () => {
    const invalid = [set(50, 0), set(50, -1), set(-1), set(NaN), set(Infinity), set(50, NaN), set(50, Infinity), set(50, 10, false), { ...set(), unit: 'oz' } as unknown as SetLog];
    expect(stats([
      workout('2026-10-01', { completed: false }), workout('2026-10-02', { exercises: [] }),
      loaded('2026-10-03', invalid), loaded('2026-10-04', [...invalid, set(0)]),
    ])).toMatchObject({ completedWorkouts: 1, personalBests: 0 });
  });

  it('rejects malformed, impossible and future dates, but accepts leap days and today', () => {
    const dates = ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01', '2026-10-08T00:00:00Z', 'garbage', '2026-10-09', '2024-02-29', '2026-10-08'];
    expect(stats(dates.map(date => workout(date))).completedWorkouts).toBe(2);
    expect(computeSocialStats([workout('2026-10-01')], new Date(NaN)).completedWorkouts).toBe(0);
  });

  it('deduplicates both IDs and date/day reimports without partial copies hiding completion', () => {
    const logs = [workout('2026-10-01', { id: 'shared', completed: false }), workout('2026-10-01', { id: 'shared' }),
      workout('2026-10-02', { id: 'shared' }), workout('2026-10-01', { id: 'reimported' }),
      workout('2026-10-01', { id: 'another-day', routineDayId: 'day-2' })];
    expect(stats(logs).completedWorkouts).toBe(2);
    expect(stats([...logs].reverse())).toEqual(stats(logs));
  });

  it('prefers the more complete duplicate and does not mutate input', () => {
    const logs = [loaded('2026-10-01', [set()]), loaded('2026-10-02', [set(55)]),
      { ...loaded('2026-10-02', [set(60), set(70)]), id: 'import' }];
    const before = structuredClone(logs);
    expect(stats(logs)).toMatchObject({ completedWorkouts: 2, personalBests: 1 });
    expect(logs).toEqual(before);
  });
});

describe('UTC Monday–Sunday streaks', () => {
  it('uses the UTC calendar even when the supplied instant has another local date', () => {
    const logs = [workout('2026-10-04'), workout('2026-10-05')];
    expect(computeSocialStats(logs, new Date('2026-10-04T23:30:00-07:00'))).toMatchObject({ completedWorkouts: 2, currentWeeklyStreak: 2 });
    expect(computeSocialStats(logs, new Date('2026-10-05T00:30:00+02:00'))).toMatchObject({ completedWorkouts: 1, currentWeeklyStreak: 1 });
  });

  it('retains current streak in the following rest week, but not after two weeks', () => {
    const logs = ['2026-09-21', '2026-09-27', '2026-09-28'].map(date => workout(date));
    expect(computeSocialStats(logs, new Date('2026-10-05T00:00:00Z'))).toMatchObject({ currentWeeklyStreak: 2, bestWeeklyStreak: 2 });
    const rested = computeSocialStats(logs, new Date('2026-10-12T00:00:00Z'));
    expect(rested).toMatchObject({ currentWeeklyStreak: 0, bestWeeklyStreak: 2 });
    expect(rested.badges.find(badge => badge.id === 'streak-2')?.earned).toBe(true);
  });

  it('keeps the historical longest run across gaps and year boundaries', () => {
    const logs = ['2025-12-22', '2025-12-29', '2026-01-05', '2026-09-28', '2026-10-05'].map(date => workout(date));
    expect(stats(logs)).toMatchObject({ currentWeeklyStreak: 2, bestWeeklyStreak: 3 });
  });
});

describe('personal records', () => {
  it('establishes a baseline, ignores intra-workout improvements, and counts one PR per exercise/session', () => {
    expect(stats([loaded('2026-10-01', [set(40), set(50), set(60)])]).personalBests).toBe(0);
    expect(stats([loaded('2026-10-01', [set(50)]), loaded('2026-10-02', [set(55), set(60), set(70)])]).personalBests).toBe(1);
  });

  it('matches normalized names rather than imported IDs and compares the historical maximum', () => {
    const logs = [loaded('2026-10-01', [set(50)], '  Bench   PRESS ', 'old'),
      loaded('2026-10-02', [set(60)], 'bench press', 'new'), loaded('2026-10-03', [set(40)], 'BENCH PRESS'),
      loaded('2026-10-04', [set(50)], 'bench press')];
    expect(stats(logs.reverse()).personalBests).toBe(1);
  });

  it('converts pounds to kg and ignores insignificant conversion rounding', () => {
    const logs = [loaded('2026-10-01', [set(100, 10, true, 'lb')]),
      loaded('2026-10-02', [set(45.359237)]), loaded('2026-10-03', [set(100.000001, 10, true, 'lb')]),
      loaded('2026-10-04', [set(50)])];
    expect(stats(logs).personalBests).toBe(1);
  });

  it('recognizes extra repetitions by estimated strength, not any heavier load', () => {
    expect(stats([loaded('2026-10-01', [set(50, 10)]), loaded('2026-10-02', [set(50, 11)]), loaded('2026-10-03', [set(55, 1)])]).personalBests).toBe(1);
  });

  it('excludes bodyweight, undone sets, partial workouts and reimports from PRs', () => {
    const logs = [loaded('2026-10-01', [set(0, 20)]), loaded('2026-10-02', [set(50)]),
      loaded('2026-10-03', [set(100, 10, false), set(0, 100)]),
      { ...loaded('2026-10-04', [set(100)]), completed: false },
      { ...loaded('2026-10-02', [set(50)]), id: 'reimport' }];
    expect(stats(logs)).toMatchObject({ completedWorkouts: 3, personalBests: 0 });
  });

  it('allows different exercises to earn a PR each, merging repeated names in a session', () => {
    const first = workout('2026-10-01', { exercises: ['Squat', 'Press'].map(name => ({ exerciseId: name, exerciseName: name, sets: [set()] })) });
    const next = workout('2026-10-02', { exercises: ['Squat', 'Press', ' SQUAT '].map(name => ({ exerciseId: name, exerciseName: name, sets: [set(60)] })) });
    expect(stats([first, next]).personalBests).toBe(2);
  });
});

describe('badges and goals', () => {
  it('exposes every locked badge with clear metadata and finite capped progress', () => {
    const empty = stats([]);
    expect(empty).toMatchObject({ completedWorkouts: 0, currentWeeklyStreak: 0, bestWeeklyStreak: 0, personalBests: 0 });
    expect(empty.badges.map(badge => badge.id)).toEqual(['first-workout', 'workouts-10', 'workouts-25', 'workouts-50', 'streak-2', 'streak-4', 'streak-8', 'personal-best']);
    for (const badge of empty.badges) {
      expect(badge).toMatchObject({ earned: false, progress: 0 });
      expect(badge.title.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(20);
      expect(badge.target).toBeGreaterThan(0);
    }
    const logs = Array.from({ length: 60 }, (_, index) => workout(new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10)));
    for (const badge of stats(logs).badges) {
      expect(Number.isFinite(badge.progress)).toBe(true);
      expect(badge.progress).toBeLessThanOrEqual(badge.target);
      expect(badge.earned).toBe(badge.progress === badge.target);
    }
    expect(stats(logs).badges.filter(badge => badge.id.startsWith('workouts-')).every(badge => badge.earned)).toBe(true);
    expect(stats(logs).badges.find(badge => badge.id === 'streak-8')?.earned).toBe(true);
  });

  it('counts inclusive goal dates using the same completed, nonfuture, deduplicated sessions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const logs = [workout('2026-10-01'), workout('2026-10-08'), workout('2026-10-09'),
      workout('2026-09-30'), workout('2026-10-03', { completed: false }),
      workout('2026-10-01', { id: 'import' }), loaded('2026-10-02', [set(0)])];
    expect(goalProgress(logs, '2026-10-01', '2026-10-08')).toBe(3);
    expect(goalProgress(logs, '2026-10-01', '2026-10-31')).toBe(3);
    expect(goalProgress(logs, '2026-10-08', '2026-10-08')).toBe(1);
    expect(goalProgress(logs, '2026-10-09', '2026-10-08')).toBe(0);
    expect(goalProgress(logs, '2026-02-29', '2026-10-08')).toBe(0);
    expect(goalProgress(logs, '2026-10-01', 'bad')).toBe(0);
  });
});
