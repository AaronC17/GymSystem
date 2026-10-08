import type { BadgeId } from './socialTypes.js';

export type KyoBadgeId = Exclude<BadgeId, 'workouts-50' | 'streak-8'>;
type BadgeDefinition = {
  id: KyoBadgeId;
  title: string;
  description: string;
  motto: string;
  chapter: string;
  requirement: string;
  artwork: string;
  accent: string;
  metric: 'completedWorkouts' | 'bestWeeklyStreak' | 'personalBests';
  target: number;
};

/** Stable achievement IDs preserve earned progress and existing publications. */
export const KYO_BADGES: readonly BadgeDefinition[] = [
  { id: 'first-workout', title: 'Despertar', description: 'Completa tu primer entrenamiento con al menos una serie válida realizada.', motto: 'Todo empieza con una decisión.', chapter: 'Origen', requirement: '1 entrenamiento', artwork: '/badges/kyo-despertar.svg', accent: '#D7F45B', metric: 'completedWorkouts', target: 1 },
  { id: 'workouts-10', title: 'En la zona', description: 'Completa 10 entrenamientos únicos con series válidas realizadas.', motto: 'Ese momento en que todo fluye.', chapter: 'Impulso', requirement: '10 entrenamientos', artwork: '/badges/kyo-en-la-zona.svg', accent: '#8ED8C8', metric: 'completedWorkouts', target: 10 },
  { id: 'workouts-25', title: 'Garra firme', description: 'Completa 25 entrenamientos únicos con series válidas realizadas.', motto: 'La fuerza se construye, paso a paso.', chapter: 'Carácter', requirement: '25 entrenamientos', artwork: '/badges/kyo-garra-firme.svg', accent: '#FFB98A', metric: 'completedWorkouts', target: 25 },
  { id: 'streak-2', title: 'Ritmo felino', description: 'Entrena al menos una vez por semana durante 2 semanas consecutivas, de lunes a domingo UTC. El descanso tiene su espacio.', motto: 'Tu ritmo. Tu propio camino.', chapter: 'Equilibrio', requirement: '2 semanas seguidas', artwork: '/badges/kyo-ritmo-felino.svg', accent: '#C7B8FF', metric: 'bestWeeklyStreak', target: 2 },
  { id: 'streak-4', title: 'Instinto constante', description: 'Entrena al menos una vez por semana durante 4 semanas consecutivas, de lunes a domingo UTC. Conservas el logro al descansar.', motto: 'Volver también es avanzar.', chapter: 'Constancia', requirement: '4 semanas seguidas', artwork: '/badges/kyo-instinto-constante.svg', accent: '#8ED8C8', metric: 'bestWeeklyStreak', target: 4 },
  { id: 'personal-best', title: 'Nueva forma', description: 'Supera tu fuerza estimada de una sesión anterior en un ejercicio con carga. Kyon compara peso y repeticiones con Epley, convirtiendo kg/lb; la primera sesión y el peso corporal no cuentan.', motto: 'No eres quien eras ayer.', chapter: 'Evolución', requirement: '1 marca personal', artwork: '/badges/kyo-nueva-forma.svg', accent: '#C7B8FF', metric: 'personalBests', target: 1 },
];

export const ALL_BADGE_IDS: readonly BadgeId[] = [...KYO_BADGES.map(badge => badge.id), 'workouts-50', 'streak-8'];
export const getKyoBadge = (id: BadgeId) => KYO_BADGES.find(badge => badge.id === id);
