import type { AppState } from './types.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStoredState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<AppState>;
  if (state.unit !== 'kg' && state.unit !== 'lb') return false;
  if (!state.routine || typeof state.routine !== 'object' || !Array.isArray(state.routine.days)) return false;
  if (typeof state.routine.id !== 'string' || typeof state.routine.name !== 'string') return false;

  const validDays = state.routine.days.every((day) =>
    typeof day.id === 'string' &&
    Number.isInteger(day.dayOfWeek) && day.dayOfWeek >= 0 && day.dayOfWeek <= 6 &&
    typeof day.title === 'string' &&
    typeof day.focus === 'string' &&
    typeof day.color === 'string' &&
    isFiniteNumber(day.duration) &&
    Array.isArray(day.exercises) && day.exercises.length > 0 &&
    day.exercises.every((exercise) =>
      typeof exercise.id === 'string' &&
      typeof exercise.name === 'string' &&
      Number.isInteger(exercise.sets) && exercise.sets > 0 &&
      typeof exercise.reps === 'string' &&
      isFiniteNumber(exercise.rest),
    ),
  );
  if (!validDays || !Array.isArray(state.logs)) return false;

  return state.logs.every((log) =>
    typeof log.id === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(log.date) &&
    typeof log.routineDayId === 'string' &&
    typeof log.title === 'string' &&
    isFiniteNumber(log.duration) &&
    typeof log.completed === 'boolean' &&
    Array.isArray(log.exercises) &&
    log.exercises.every((exercise) =>
      typeof exercise.exerciseId === 'string' &&
      typeof exercise.exerciseName === 'string' &&
      Array.isArray(exercise.sets) &&
      exercise.sets.every((set) =>
        isFiniteNumber(set.weight) &&
        isFiniteNumber(set.reps) &&
        typeof set.done === 'boolean' &&
        (set.unit === 'kg' || set.unit === 'lb'),
      ),
    ),
  );
}
