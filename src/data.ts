import type { AppState, Exercise, Routine, Unit, WorkoutLog } from './types';
import { isStoredState } from './stateSchema';

export { isStoredState } from './stateSchema';

export const LEGACY_STATE_KEY = 'tempo-app-state-v2';

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

export function readStoredState(key = LEGACY_STATE_KEY): AppState | null {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isStoredState(parsed)) return parsed;
    }
  } catch {
    // Fall back to a clean state if local storage is unavailable or invalid.
  }
  return null;
}

export function loadState(): AppState {
  return readStoredState() ?? createInitialState();
}

export function saveState(state: AppState, key = LEGACY_STATE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
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
      focus: '',
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
