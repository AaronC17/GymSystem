import { describe, expect, it } from 'vitest';
import { bestCompletedSet, plannedSessionsInMonth } from '../src/metrics';
import type { Routine, SetLog } from '../src/types';

function routine(weekdays: number[]): Routine {
  return { id: 'routine-fixture', name: 'Fixture', days: weekdays.map((dayOfWeek, index) => ({
    id: `day-${index}`, dayOfWeek, title: 'Fixture', focus: '', color: '#fff', duration: 40, exercises: [],
  })) };
}

describe('progress metrics', () => {
  it('counts actual Thursdays in October 2026 instead of assuming four weeks', () => {
    expect(plannedSessionsInMonth(routine([4]), new Date(2026, 9, 8))).toBe(5);
  });

  it('handles leap years and years with a four-week February', () => {
    expect(plannedSessionsInMonth(routine([4]), new Date(2024, 1, 1))).toBe(5);
    expect(plannedSessionsInMonth(routine([4]), new Date(2026, 1, 1))).toBe(4);
  });

  it('matches calendar days for an empty plan or duplicate weekday assignments', () => {
    expect(plannedSessionsInMonth(routine([]), new Date(2026, 9, 1))).toBe(0);
    expect(plannedSessionsInMonth(routine([4, 4]), new Date(2026, 9, 1))).toBe(5);
    expect(plannedSessionsInMonth(routine([0, 1, 2, 3, 4, 5, 6]), new Date(2026, 9, 1))).toBe(31);
  });

  it('retains a completed bodyweight set instead of treating zero as missing', () => {
    const set: SetLog = { weight: 0, unit: 'kg', reps: 12, done: true };
    expect(bestCompletedSet([set], 'kg')).toBe(set);
  });

  it('ignores unfinished sets and compares original mixed units correctly', () => {
    const sets: SetLog[] = [
      { weight: 100, unit: 'kg', reps: 10, done: false },
      { weight: 20, unit: 'kg', reps: 10, done: true },
      { weight: 50, unit: 'lb', reps: 8, done: true },
    ];
    expect(bestCompletedSet(sets, 'kg')).toBe(sets[2]);
    expect(bestCompletedSet(sets, 'lb')).toBe(sets[2]);
  });

  it('returns no data only if no set is completed', () => {
    expect(bestCompletedSet([], 'kg')).toBeNull();
    expect(bestCompletedSet([{ weight: 0, unit: 'kg', reps: 0, done: false }], 'kg')).toBeNull();
  });
});
