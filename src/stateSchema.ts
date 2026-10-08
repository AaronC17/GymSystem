import type { AppState } from './types.js';

// Planned sets are used to allocate arrays when a workout starts.
// Bound this count without truncating historical workout set arrays.
export const MAX_ROUTINE_SETS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isArrayOf(value: unknown, validate: (item: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!validate(item)) return false;
  }
  return true;
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= daysInMonth;
}

function isRoutineExercise(value: unknown) {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.sets === 'number' && Number.isSafeInteger(value.sets) && value.sets > 0 && value.sets <= MAX_ROUTINE_SETS &&
    typeof value.reps === 'string' &&
    isNonNegativeNumber(value.rest) &&
    isOptionalString(value.note) &&
    isOptionalString(value.muscle) &&
    isOptionalString(value.link);
}

function isRoutineDay(value: unknown) {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.dayOfWeek === 'number' && Number.isInteger(value.dayOfWeek) && value.dayOfWeek >= 0 && value.dayOfWeek <= 6 &&
    typeof value.title === 'string' &&
    typeof value.focus === 'string' &&
    typeof value.color === 'string' &&
    isNonNegativeNumber(value.duration) &&
    isArrayOf(value.exercises, isRoutineExercise) && value.exercises.length > 0;
}

function isSetLog(value: unknown) {
  return isRecord(value) &&
    isNonNegativeNumber(value.weight) &&
    isNonNegativeNumber(value.reps) &&
    typeof value.done === 'boolean' &&
    (value.unit === 'kg' || value.unit === 'lb');
}

function isExerciseLog(value: unknown) {
  return isRecord(value) &&
    typeof value.exerciseId === 'string' &&
    typeof value.exerciseName === 'string' &&
    isArrayOf(value.sets, isSetLog);
}

function isWorkoutLog(value: unknown) {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    isDateKey(value.date) &&
    typeof value.routineDayId === 'string' &&
    typeof value.title === 'string' &&
    isNonNegativeNumber(value.duration) &&
    typeof value.completed === 'boolean' &&
    isArrayOf(value.exercises, isExerciseLog);
}

export function isStoredState(value: unknown): value is AppState {
  if (!isRecord(value) || (value.unit !== 'kg' && value.unit !== 'lb')) return false;
  const routine = value.routine;
  return isRecord(routine) &&
    typeof routine.id === 'string' &&
    typeof routine.name === 'string' &&
    isOptionalString(routine.sourceName) &&
    isOptionalString(routine.importedAt) &&
    isArrayOf(routine.days, isRoutineDay) &&
    isArrayOf(value.logs, isWorkoutLog);
}
