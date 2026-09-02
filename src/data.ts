import type { AppState, Exercise, Routine, Unit, WorkoutLog } from './types';

export const DAY_NAMES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

export const DAY_NAMES_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

export const ACCENT_COLORS = ['#d7f45b', '#c7b8ff', '#ffb98a', '#8ed8c8', '#9fc2ff'];

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function startOfWeek(date: Date) {
  const result = new Date(date);
  const offset = result.getDay() === 0 ? -6 : 1 - result.getDay();
  result.setDate(result.getDate() + offset);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function convertWeight(value: number, from: Unit, to: Unit) {
  if (from === to) return value;
  return from === 'kg' ? value * 2.20462 : value / 2.20462;
}

export function displayWeight(value: number, from: Unit, to: Unit) {
  const converted = convertWeight(value, from, to);
  return Math.round(converted * 2) / 2;
}

export function createInitialState(): AppState {
  return {
    routine: {
      id: 'routine-empty',
      name: '',
      days: [],
    },
    logs: [],
    unit: 'kg',
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStoredState(value: unknown): value is AppState {
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

export function loadState(): AppState {
  try {
    const saved = localStorage.getItem('tempo-app-state-v2');
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isStoredState(parsed)) return parsed;
    }
  } catch {
    // Fall back to a clean state if local storage is unavailable or invalid.
  }
  return createInitialState();
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem('tempo-app-state-v2', JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function routineFromParsed(
  parsed: import('./types').ParsedRoutine,
  sourceName: string,
): Routine {
  return {
    id: uid('routine'),
    name: parsed.name,
    sourceName,
    importedAt: new Date().toISOString(),
    days: parsed.days.map((day, dayIndex) => ({
      id: uid('day'),
      dayOfWeek: day.dayOfWeek,
      title: day.title,
      focus: day.exercises.slice(0, 2).map((exercise) => exercise.name).join(' · '),
      color: ACCENT_COLORS[dayIndex % ACCENT_COLORS.length],
      duration: Math.max(35, day.exercises.length * 11 + 10),
      exercises: day.exercises.map((exercise) => ({ ...exercise, id: uid('exercise') })),
    })),
  };
}

export function cloneRoutine(routine: Routine): Routine {
  return JSON.parse(JSON.stringify(routine)) as Routine;
}

export function exerciseCount(routine: Routine) {
  return routine.days.reduce((sum, day) => sum + day.exercises.length, 0);
}

export function getLastExerciseSets(
  logs: WorkoutLog[],
  exercise: Exercise,
  beforeDate?: string,
) {
  return [...logs]
    .filter((log) => !beforeDate || log.date < beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((log) => log.exercises)
    .find((entry) => entry.exerciseId === exercise.id || entry.exerciseName === exercise.name)?.sets;
}
