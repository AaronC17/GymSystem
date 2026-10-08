import { describe, expect, it } from 'vitest';
import { isStoredState, MAX_ROUTINE_SETS } from '../src/stateSchema.js';
import type { AppState } from '../src/types.js';

function validState(): AppState {
  return {
    unit: 'kg',
    routine: {
      id: 'routine-fixture',
      name: 'Fixture',
      sourceName: 'fixture.pdf',
      importedAt: '2026-10-01T00:00:00.000Z',
      days: [{
        id: 'day-fixture', dayOfWeek: 1, title: 'Fixture', focus: '', color: '#fff', duration: 30,
        exercises: [{ id: 'exercise-fixture', name: 'Fixture', sets: 3, reps: '8-12', rest: 60, note: '', muscle: 'Fixture', link: 'https://example.invalid/exercise' }],
      }],
    },
    logs: [{
      id: 'log-fixture', date: '2026-10-01', routineDayId: 'archived-day', title: 'Fixture', duration: 30, completed: false,
      exercises: [{ exerciseId: 'exercise-fixture', exerciseName: 'Fixture', sets: [{ weight: 20.5, reps: 8, done: true, unit: 'kg' }] }],
    }],
  };
}

function replace(path: readonly (string | number)[], value: unknown): unknown {
  const state = validState();
  let current: unknown = state;
  for (const key of path.slice(0, -1)) current = (current as Record<string | number, unknown>)[key];
  (current as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return state;
}

describe('isStoredState', () => {
  it('preserves valid imported routines, historical logs and fractional weights', () => {
    expect(isStoredState(validState())).toBe(true);
    expect(isStoredState(JSON.parse(JSON.stringify(validState())))).toBe(true);
  });

  it('preserves an empty routine and history after deleting a routine', () => {
    const state = validState();
    state.routine = { id: 'routine-empty', name: '', days: [] };
    expect(isStoredState(state)).toBe(true);
    state.logs = [];
    expect(isStoredState(state)).toBe(true);
  });

  it('accepts absent optional strings and zero measurements without mutating the input', () => {
    const state = validState();
    delete state.routine.sourceName;
    delete state.routine.importedAt;
    const exercise = state.routine.days[0].exercises[0];
    delete exercise.note;
    delete exercise.muscle;
    delete exercise.link;
    exercise.rest = 0;
    state.routine.days[0].duration = 0;
    state.logs[0].duration = 0;
    state.logs[0].exercises[0].sets[0].weight = 0;
    state.logs[0].exercises[0].sets[0].reps = 0;
    const before = structuredClone(state);
    expect(isStoredState(state)).toBe(true);
    expect(state).toEqual(before);
  });

  it.each([null, undefined, false, 0, 'state', [], Object.assign([], validState())])('rejects malformed root %j without throwing', (value) => {
    expect(() => isStoredState(value)).not.toThrow();
    expect(isStoredState(value)).toBe(false);
  });

  const records = [
    ['routine'],
    ['routine', 'days', 0],
    ['routine', 'days', 0, 'exercises', 0],
    ['logs', 0],
    ['logs', 0, 'exercises', 0],
    ['logs', 0, 'exercises', 0, 'sets', 0],
  ] as const;

  it.each(records.map((path) => ({ path })))('rejects malformed object at $path without throwing', ({ path }) => {
    for (const value of [null, undefined, [], false, 1, 'item']) {
      const state = replace(path, value);
      expect(() => isStoredState(state)).not.toThrow();
      expect(isStoredState(state)).toBe(false);
    }
  });

  const arrays = [
    ['routine', 'days'],
    ['routine', 'days', 0, 'exercises'],
    ['logs'],
    ['logs', 0, 'exercises'],
    ['logs', 0, 'exercises', 0, 'sets'],
  ] as const;

  it.each(arrays.map((path) => ({ path })))('rejects malformed or sparse array at $path', ({ path }) => {
    for (const value of [null, undefined, {}, 'items', Array(1)]) {
      expect(isStoredState(replace(path, value))).toBe(false);
    }
  });

  it('allows empty workout exercises and sets, but not an empty routine day', () => {
    expect(isStoredState(replace(['logs', 0, 'exercises'], []))).toBe(true);
    expect(isStoredState(replace(['logs', 0, 'exercises', 0, 'sets'], []))).toBe(true);
    expect(isStoredState(replace(['routine', 'days', 0, 'exercises'], []))).toBe(false);
  });

  it.each([-1, NaN, Infinity, -Infinity, '1', null, undefined])('rejects invalid non-negative number %s', (value) => {
    const paths = [
      ['routine', 'days', 0, 'duration'],
      ['routine', 'days', 0, 'exercises', 0, 'rest'],
      ['logs', 0, 'duration'],
      ['logs', 0, 'exercises', 0, 'sets', 0, 'weight'],
      ['logs', 0, 'exercises', 0, 'sets', 0, 'reps'],
    ] as const;
    for (const path of paths) expect(isStoredState(replace(path, value))).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_ROUTINE_SETS + 1, 2 ** 32, Number.MAX_SAFE_INTEGER + 1, '3', null])('rejects invalid routine set count %s', (value) => {
    expect(isStoredState(replace(['routine', 'days', 0, 'exercises', 0, 'sets'], value))).toBe(false);
  });

  it('accepts the largest planned set count without limiting historical set arrays', () => {
    expect(isStoredState(replace(['routine', 'days', 0, 'exercises', 0, 'sets'], MAX_ROUTINE_SETS))).toBe(true);
    const state = validState();
    const set = state.logs[0].exercises[0].sets[0];
    state.logs[0].exercises[0].sets = Array.from({ length: MAX_ROUTINE_SETS + 1 }, () => ({ ...set }));
    expect(isStoredState(state)).toBe(true);
  });

  it.each([-1, 7, 1.5, NaN, Infinity, '1', null])('rejects invalid weekday %s', (value) => {
    expect(isStoredState(replace(['routine', 'days', 0, 'dayOfWeek'], value))).toBe(false);
  });

  it.each(['2024-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '2026-12-31', '0000-01-01', '0099-12-31'])('accepts real calendar date %s', (date) => {
    expect(isStoredState(replace(['logs', 0, 'date'], date))).toBe(true);
  });

  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-12-00', '2026-10-32', '2026-2-01', '2026-10-01T00:00:00Z', ['2026-10-01'], null, 20261001])('rejects impossible or non-string date %j', (date) => {
    expect(isStoredState(replace(['logs', 0, 'date'], date))).toBe(false);
  });

  it.each([
    ['routine', 'sourceName'],
    ['routine', 'importedAt'],
    ['routine', 'days', 0, 'exercises', 0, 'note'],
    ['routine', 'days', 0, 'exercises', 0, 'muscle'],
    ['routine', 'days', 0, 'exercises', 0, 'link'],
  ].map((path) => ({ path })))('rejects non-string optional field at $path', ({ path }) => {
    for (const value of [null, {}, [], 1, false]) expect(isStoredState(replace(path, value))).toBe(false);
    expect(isStoredState(replace(path, ''))).toBe(true);
    expect(isStoredState(replace(path, undefined))).toBe(true);
  });
});
