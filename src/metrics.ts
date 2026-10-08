import { convertWeight } from './data';
import type { Routine, SetLog, Unit } from './types';

export function bestCompletedSet(sets: SetLog[], unit: Unit): SetLog | null {
  return sets.reduce<SetLog | null>((best, set) => {
    if (!set.done) return best;
    if (!best) return set;
    return convertWeight(set.weight, set.unit, unit) > convertWeight(best.weight, best.unit, unit) ? set : best;
  }, null);
}

export function plannedSessionsInMonth(routine: Routine, month: Date): number {
  const weekdays = new Set(routine.days.map((day) => day.dayOfWeek));
  const date = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  let count = 0;
  while (date < end) {
    if (weekdays.has(date.getDay())) count += 1;
    date.setDate(date.getDate() + 1);
  }
  return count;
}
