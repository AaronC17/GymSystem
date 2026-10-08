import type { SocialDashboard, SocialPost } from './socialTypes';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 320): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => text(v, 40) && Number.isFinite(Date.parse(v));
const person = (v: unknown) => record(v) && text(v.name, 200) && text(v.email);
const badgeIds = new Set(['first-workout', 'workouts-10', 'workouts-25', 'workouts-50', 'streak-2', 'streak-4', 'streak-8', 'personal-best']);
function stats(v: unknown) {
  return record(v) && count(v.completedWorkouts) && count(v.currentWeeklyStreak) && count(v.bestWeeklyStreak) && count(v.personalBests) &&
    Array.isArray(v.badges) && v.badges.length <= 20 && v.badges.every(b => record(b) && badgeIds.has(String(b.id)) &&
      text(b.title, 100) && text(b.description, 500) && typeof b.earned === 'boolean' && count(b.progress) && count(b.target) && Number(b.target) > 0 && Number(b.progress) <= Number(b.target));
}
function socialPerson(v: unknown) {
  return record(v) && person(v) && typeof v.sharing === 'boolean' && (v.stats === null || stats(v.stats));
}
export function isSocialPost(p: unknown): p is SocialPost {
  return record(p) && text(p.id, 200) && person(p.owner) &&
    ['workout', 'badge'].includes(String(p.kind)) && text(p.title, 200) && text(p.detail, 1000) &&
    typeof p.description === 'string' && p.description.length <= 500 && typeof p.hasWorkoutDetails === 'boolean' &&
    (p.kind === 'workout' || p.hasWorkoutDetails === false) && date(p.createdAt) && count(p.cheers) && typeof p.cheered === 'boolean';
}
export function isSocialDashboard(v: unknown): v is SocialDashboard {
  return record(v) && text(v.userEmail) && socialPerson(v.me) &&
    Array.isArray(v.invitations) && v.invitations.length <= 200 && v.invitations.every(i => record(i) && text(i.id, 200) && person(i.from) && text(i.toEmail) && date(i.createdAt) &&
      ['incoming', 'outgoing'].includes(String(i.direction))) &&
    Array.isArray(v.friends) && v.friends.length <= 200 && v.friends.every(f => socialPerson(f) && record(f) && (f.sharing === true || f.stats === null)) &&
    Array.isArray(v.goals) && v.goals.length <= 2100 && v.goals.every(g => record(g) && text(g.id, 200) && person(g.owner) && text(g.title, 80) &&
      count(g.target) && Number(g.target) > 0 && Number(g.target) <= 100 && date(g.startDate) && date(g.endDate) && typeof g.shared === 'boolean' && count(g.progress)) &&
    Array.isArray(v.posts) && v.posts.length <= 100 && v.posts.every(isSocialPost);
}
