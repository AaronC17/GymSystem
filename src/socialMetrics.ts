import type { BadgeId, SocialBadge, SocialStats } from './socialTypes.js';
import type { SetLog, WorkoutLog } from './types.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const LB_TO_KG = 0.45359237;

// Parse calendar keys, never local midnights or implementation-dependent date strings.
function calendarDate(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp : null;
}

function validSet(set: SetLog): boolean {
  return set.done === true && Number.isFinite(set.reps) && set.reps > 0
    && Number.isFinite(set.weight) && set.weight >= 0
    && (set.unit === 'kg' || set.unit === 'lb');
}

function completedSessions(logs: WorkoutLog[], now: Date): WorkoutLog[] {
  const today = Number.isFinite(now.getTime()) ? calendarDate(now.toISOString().slice(0, 10)) : null;
  if (today === null) return [];
  const candidates = logs.flatMap(log => {
    const date = calendarDate(log.date);
    const sets = log.exercises.reduce((count, exercise) => count + exercise.sets.filter(validSet).length, 0);
    return log.completed === true && date !== null && date <= today && sets > 0
      ? [{ log, sets }] : [];
  });
  // Reimports can have a new ID. Prefer the most complete eligible copy, so an
  // incomplete/empty copy cannot suppress a completed session. Do not merge sets.
  candidates.sort((a, b) => b.sets - a.sets || a.log.date.localeCompare(b.log.date)
    || a.log.id.localeCompare(b.log.id));
  // Link both identities transitively: an ignored reimport can still establish
  // that another copy with the same ID belongs to this already-counted session.
  const parents = new Map<string, string>();
  const root = (key: string): string => {
    let current = key;
    while (parents.has(current) && parents.get(current) !== current) current = parents.get(current)!;
    let node = key;
    while (parents.has(node) && parents.get(node) !== current) {
      const next = parents.get(node)!;
      parents.set(node, current);
      node = next;
    }
    return current;
  };
  for (const { log } of candidates) {
    const id = root(`id:${log.id}`);
    const session = root(`session:${JSON.stringify([log.date, log.routineDayId])}`);
    parents.set(id, session);
  }
  const seen = new Set<string>();
  const result: WorkoutLog[] = [];
  for (const { log } of candidates) {
    const key = root(`id:${log.id}`);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(log);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function weekStart(date: number): number {
  const weekday = new Date(date).getUTCDay();
  return date - ((weekday + 6) % 7) * DAY;
}

function personalBests(logs: WorkoutLog[]): number {
  const history = new Map<string, number>();
  let count = 0;
  for (const log of logs) {
    const session = new Map<string, number>();
    for (const exercise of log.exercises) {
      const name = exercise.exerciseName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!name) continue;
      for (const set of exercise.sets) {
        if (!validSet(set) || set.weight === 0) continue;
        // Epley estimated 1RM. Bodyweight is not a comparable external load.
        const kg = set.weight * (set.unit === 'lb' ? LB_TO_KG : 1);
        const score = kg * (1 + set.reps / 30);
        if (Number.isFinite(score)) session.set(name, Math.max(session.get(name) ?? 0, score));
      }
    }
    for (const [name, score] of session) {
      const previous = history.get(name);
      // Compare with prior sessions only, not other sets in this workout. A tiny
      // relative tolerance prevents rounded kg/lb conversions producing fake PRs.
      if (previous !== undefined && score > previous + Math.max(1e-6, previous * 1e-6)) count++;
      history.set(name, Math.max(previous ?? 0, score));
    }
  }
  return count;
}

export function computeSocialStats(logs: WorkoutLog[], now: Date = new Date()): SocialStats {
  const sessions = completedSessions(logs, now);
  const weeks = [...new Set(sessions.map(log => weekStart(calendarDate(log.date)!)))].sort((a, b) => a - b);
  let bestWeeklyStreak = 0;
  let run = 0;
  for (let index = 0; index < weeks.length; index++) {
    run = index > 0 && weeks[index] - weeks[index - 1] === WEEK ? run + 1 : 1;
    bestWeeklyStreak = Math.max(bestWeeklyStreak, run);
  }
  const currentWeek = Number.isFinite(now.getTime()) ? weekStart(calendarDate(now.toISOString().slice(0, 10))!) : NaN;
  const lastWeek = weeks[weeks.length - 1];
  const currentWeeklyStreak = lastWeek === currentWeek || lastWeek === currentWeek - WEEK ? run : 0;
  const completedWorkouts = sessions.length;
  const records = personalBests(sessions);
  const badges: SocialBadge[] = [];
  const badge = (id: BadgeId, title: string, description: string, value: number, target: number) => {
    badges.push({ id, title, description, earned: value >= target, progress: Math.min(target, Math.max(0, value)), target });
  };
  badge('first-workout', 'Primer entrenamiento', 'Completa un entrenamiento con al menos una serie válida realizada.', completedWorkouts, 1);
  for (const target of [10, 25, 50] as const) {
    badge(`workouts-${target}`, `${target} entrenamientos`, `Completa ${target} entrenamientos únicos con series válidas realizadas.`, completedWorkouts, target);
  }
  for (const target of [2, 4, 8] as const) {
    badge(`streak-${target}`, `${target} semanas seguidas`, `Entrena al menos una vez por semana durante ${target} semanas consecutivas (lunes a domingo UTC). Se conserva tras un descanso.`, bestWeeklyStreak, target);
  }
  badge('personal-best', 'Nueva marca personal', 'Mejora tu máximo histórico de fuerza estimada Epley (peso en kg × (1 + repeticiones / 30)) en otra sesión. No cuenta la primera sesión ni peso corporal; máximo una marca por ejercicio y sesión.', records, 1);
  return { completedWorkouts, currentWeeklyStreak, bestWeeklyStreak, personalBests: records, badges };
}

/** Inclusive calendar range. Returns a count; consumers cap it to their goal target. */
export function goalProgress(logs: WorkoutLog[], startDate: string, endDate: string): number {
  const start = calendarDate(startDate);
  const end = calendarDate(endDate);
  if (start === null || end === null || start > end) return 0;
  return completedSessions(logs, new Date()).filter(log => log.date >= startDate && log.date <= endDate).length;
}
