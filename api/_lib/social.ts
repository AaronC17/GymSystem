import { createHash, randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { AuthUser, WorkoutLog } from '../../src/types.js';
import type { SocialAction, SocialDashboard, SocialGoal, SocialPerson, SocialPost, SocialWorkoutDetail } from '../../src/socialTypes.js';
import { computeSocialStats, goalProgress } from '../../src/socialMetrics.js';
import { ALL_BADGE_IDS } from '../../src/badgeCatalog.js';
import { isStoredState } from '../../src/stateSchema.js';
import { findAccount } from './accounts.js';

type Relationship = {
  _id: string; invitationId: string; from: AuthUser; toEmail: string;
  members: string[]; state: 'pending' | 'accepted' | 'declined' | 'removed';
  createdAt: Date; updatedAt: Date;
};
type Goal = Omit<SocialGoal, 'owner' | 'progress'>;
type Profile = { _id: string; sharing: boolean; goals: Goal[] };
type Post = { _id: string; ownerEmail: string; kind: 'workout' | 'badge'; title: string; detail: string; description?: string; workoutSnapshot?: unknown; createdAt: Date; cheerers: string[] };
type Quota = { _id: string; count: number; expiresAt: Date };

export class SocialError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new SocialError(status, message); }
function duplicate(error: unknown) { return !!error && typeof error === 'object' && 'code' in error && error.code === 11000; }
function hash(parts: string[]) { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
export function socialPairId(a: string, b: string) { return hash([a, b].sort()); }
export function normalizedSocialEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  const local = email.split('@')[0];
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') ? email : null;
}
export function validSocialId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f-\x9f]/.test(value); }
const id = validSocialId;
function description(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) fail(400, 'La descripción debe tener hasta 500 caracteres y no incluir caracteres de control.');
  return value.trim();
}
const MAX_SNAPSHOT_BYTES = 500 * 1024;
function validSnapshot(value: unknown): value is WorkoutLog {
  return isStoredState({ unit: 'kg', routine: { id: '', name: '', days: [] }, logs: [value] }) &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_SNAPSHOT_BYTES;
}
// Copy only this workout's schema fields, never arbitrary persisted metadata.
function snapshot(workout: WorkoutLog): WorkoutLog {
  return { id: workout.id, date: workout.date, routineDayId: workout.routineDayId, title: workout.title, duration: workout.duration, completed: workout.completed,
    exercises: workout.exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName,
      sets: exercise.sets.map((set) => ({ weight: set.weight, reps: set.reps, done: set.done, unit: set.unit })) })) };
}
export function validSocialDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseSocialAction(body: unknown, now = new Date()): SocialAction {
  if (typeof body === 'string') {
    if (body.length > 4096) fail(400, 'Solicitud inválida.');
    try { body = JSON.parse(body); } catch { fail(400, 'Solicitud inválida.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Solicitud inválida.');
  const action = body as Record<string, unknown>;
  switch (action.type) {
    case 'invite': case 'removeFriend': {
      const email = normalizedSocialEmail(action.email);
      if (!email) fail(400, 'Ingresa un correo válido.');
      return { type: action.type, email };
    }
    case 'accept': case 'decline': case 'cancel':
      if (id(action.invitationId)) return { type: action.type, invitationId: action.invitationId };
      break;
    case 'setSharing':
      if (typeof action.sharing === 'boolean') return { type: action.type, sharing: action.sharing };
      break;
    case 'createGoal': {
      const { title, target, startDate, endDate, shared } = action;
      if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 80 || /[\x00-\x1f]/.test(title) || typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > 100 || typeof shared !== 'boolean' || !validSocialDate(startDate) || !validSocialDate(endDate)) break;
      const start = Date.parse(startDate); const end = Date.parse(endDate);
      const today = Date.parse(now.toISOString().slice(0, 10));
      if (end < start || end - start > 89 * 86400000 || start < today - 366 * 86400000 || end > today + 366 * 86400000) break;
      return { type: 'createGoal', title: title.trim(), target, startDate, endDate, shared };
    }
    case 'deleteGoal': if (id(action.goalId)) return { type: action.type, goalId: action.goalId }; break;
    case 'shareWorkout': if (id(action.workoutId)) return { type: action.type, workoutId: action.workoutId, description: description(action.description) }; break;
    case 'shareBadge':
      if (typeof action.badgeId === 'string' && ALL_BADGE_IDS.some(id => id === action.badgeId)) return { type: 'shareBadge', badgeId: action.badgeId as Extract<SocialAction, { type: 'shareBadge' }>['badgeId'], description: description(action.description) };
      break;
    case 'deletePost': case 'cheer': if (id(action.postId)) return { type: action.type, postId: action.postId }; break;
  }
  return fail(400, 'La acción no tiene un formato válido.');
}

export class SocialService {
  constructor(private db: Db, private user: AuthUser, private now = new Date()) {}
  private get relationships() { return this.db.collection<Relationship>('socialRelationships'); }
  private get profiles() { return this.db.collection<Profile>('socialProfiles'); }
  private get posts() { return this.db.collection<Post>('socialPosts'); }
  private async logs(email: string): Promise<WorkoutLog[]> {
    const document = await this.db.collection<{ _id: string; state?: unknown }>('userStates').findOne({ _id: email }, { projection: { state: 1 } });
    return isStoredState(document?.state) ? document.state.logs : [];
  }
  private async person(email: string): Promise<AuthUser> {
    if (email === this.user.email) return this.user;
    return await this.registeredPerson(email) ?? { email, name: 'Amigo de Kyon' };
  }
  private async registeredPerson(email: string): Promise<AuthUser | null> {
    const legacy = findAccount(email);
    const account = await this.db.collection<{ _id: string; name?: unknown }>('users').findOne({ _id: email }, { projection: { name: 1 } });
    if (!account && !legacy) return null;
    return { email, name: typeof account?.name === 'string' ? account.name.slice(0, 100) : legacy?.name ?? 'Amigo de Kyon' };
  }
  async lookup(email: string): Promise<{ userEmail: string; people: AuthUser[] }> {
    await this.consumeLookupQuota();
    const person = email === this.user.email ? null : await this.registeredPerson(email);
    return { userEmail: this.user.email, people: person ? [person] : [] };
  }
  private async isFriend(email: string) {
    return !!await this.relationships.findOne({ _id: socialPairId(this.user.email, email), state: 'accepted', members: this.user.email });
  }
  private async ensureProfile() {
    await this.profiles.updateOne({ _id: this.user.email }, { $setOnInsert: { sharing: false, goals: [] } }, { upsert: true });
  }
  private async consumeInviteQuota() {
    const collection = this.db.collection<Quota>('socialInviteQuotas');
    const _id = `${this.user.email}:${this.now.toISOString().slice(0, 10)}`;
    try {
      await collection.updateOne({ _id, count: { $lt: 10 } }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(this.now.getTime() + 2 * 86400000) } }, { upsert: true });
    } catch (error) { if (duplicate(error)) fail(429, 'Puedes enviar hasta 10 invitaciones al día.'); throw error; }
  }
  private async consumeLookupQuota() {
    const collection = this.db.collection<Quota>('socialInviteQuotas');
    const _id = `lookup:${this.user.email}:${Math.floor(this.now.getTime() / 60000)}`;
    try {
      await collection.updateOne({ _id, count: { $lt: 30 } }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(this.now.getTime() + 86400000) } }, { upsert: true });
    } catch (error) { if (duplicate(error)) fail(429, 'Puedes realizar hasta 30 búsquedas por minuto.'); throw error; }
  }
  private async invite(email: string) {
    if (email === this.user.email) fail(400, 'No puedes invitarte a ti mismo.');
    if (!await this.registeredPerson(email)) fail(404, 'No encontramos esa cuenta.');
    const _id = socialPairId(this.user.email, email);
    const previous = await this.relationships.findOne({ _id });
    if (previous?.state === 'accepted') fail(409, 'Ya existe esta amistad.');
    if (previous?.state === 'pending') fail(409, 'Ya existe una invitación pendiente.');
    if (previous && this.now.getTime() - previous.updatedAt.getTime() < 86400000) fail(429, 'Espera 24 horas antes de volver a invitar.');
    // Reserve a durable quota before writing; racing attempts also consume it.
    await this.consumeInviteQuota();
    const relationship: Relationship = { _id, invitationId: `${_id}:${randomUUID()}`, from: this.user, toEmail: email, members: [this.user.email, email], state: 'pending', createdAt: this.now, updatedAt: this.now };
    if (previous) {
      const result = await this.relationships.replaceOne({ _id, state: previous.state, invitationId: previous.invitationId, updatedAt: previous.updatedAt }, relationship);
      if (!result.modifiedCount) fail(409, 'La invitación cambió. Actualiza e inténtalo de nuevo.');
    } else {
      try { await this.relationships.insertOne(relationship); }
      catch (error) { if (duplicate(error)) fail(409, 'Ya existe una invitación.'); throw error; }
    }
  }
  async act(action: SocialAction) {
    // Keep service callers subject to the same validation as HTTP callers.
    action = parseSocialAction(action, this.now);
    switch (action.type) {
      case 'invite': await this.invite(action.email); break;
      case 'accept': case 'decline': case 'cancel': {
        const audience = action.type === 'cancel' ? { 'from.email': this.user.email } : { toEmail: this.user.email };
        const result = await this.relationships.updateOne({ _id: action.invitationId.split(':')[0], invitationId: action.invitationId, state: 'pending', ...audience }, { $set: { state: action.type === 'accept' ? 'accepted' : 'declined', updatedAt: this.now } });
        if (!result.modifiedCount) fail(404, 'Invitación no disponible.');
        break;
      }
      case 'removeFriend': {
        const result = await this.relationships.updateOne({ _id: socialPairId(this.user.email, action.email), state: 'accepted', members: this.user.email }, { $set: { state: 'removed', updatedAt: this.now } });
        if (!result.modifiedCount) fail(404, 'Amistad no disponible.');
        break;
      }
      case 'setSharing':
        await this.ensureProfile();
        await this.profiles.updateOne({ _id: this.user.email }, { $set: { sharing: action.sharing } });
        break;
      case 'createGoal': {
        await this.ensureProfile();
        const goal: Goal = { id: randomUUID(), title: action.title, target: action.target, startDate: action.startDate, endDate: action.endDate, shared: action.shared };
        const result = await this.profiles.updateOne({ _id: this.user.email, 'goals.9': { $exists: false } }, { $push: { goals: goal } });
        if (!result.modifiedCount) fail(409, 'Puedes tener hasta 10 metas.');
        break;
      }
      case 'deleteGoal': {
        const result = await this.profiles.updateOne({ _id: this.user.email, 'goals.id': action.goalId }, { $pull: { goals: { id: action.goalId } } });
        if (!result.modifiedCount) fail(404, 'Meta no disponible.');
        break;
      }
      case 'shareWorkout': {
        const workout = (await this.logs(this.user.email)).find((log) => log.id === action.workoutId);
        const sets = workout?.exercises.reduce((total, exercise) => total + exercise.sets.filter((set) => set.done && set.reps > 0).length, 0) ?? 0;
        if (!workout?.completed || sets === 0 || workout.date > this.now.toISOString().slice(0, 10)) fail(400, 'Solo puedes compartir un entrenamiento propio completado.');
        const workoutSnapshot = snapshot(workout);
        if (!validSnapshot(workoutSnapshot)) fail(400, 'El detalle del entrenamiento es inválido o supera el límite de 500 KB.');
        await this.share('workout', JSON.stringify([workout.date, workout.routineDayId]), 'Entrenamiento completado', `${sets} series completadas · ${Math.round(workout.duration)} min`, action.description ?? '', workoutSnapshot);
        break;
      }
      case 'shareBadge': {
        const badge = computeSocialStats(await this.logs(this.user.email), this.now).badges.find((entry) => entry.id === action.badgeId);
        if (!badge?.earned) fail(400, 'Todavía no has conseguido esa insignia.');
        await this.share('badge', badge.id, badge.title, badge.description, action.description ?? '');
        break;
      }
      case 'deletePost': {
        const result = await this.posts.deleteOne({ _id: action.postId, ownerEmail: this.user.email });
        if (!result.deletedCount) fail(404, 'Publicación no disponible.');
        break;
      }
      case 'cheer': {
        const post = await this.posts.findOne({ _id: action.postId });
        if (!post || (post.ownerEmail !== this.user.email && !await this.isFriend(post.ownerEmail))) fail(404, 'Publicación no disponible.');
        await this.posts.updateOne({ _id: post._id, ownerEmail: post.ownerEmail }, { $addToSet: { cheerers: this.user.email } });
        break;
      }
    }
  }
  private async share(kind: Post['kind'], sourceId: string, title: string, detail: string, description: string, workoutSnapshot?: WorkoutLog) {
    const _id = hash([this.user.email, kind, sourceId]);
    await this.posts.updateOne({ _id }, { $setOnInsert: { ownerEmail: this.user.email, kind, title, detail, description, ...(workoutSnapshot ? { workoutSnapshot } : {}), createdAt: this.now, cheerers: [] } }, { upsert: true });
  }
  private postDto(post: Post, owner: AuthUser): SocialPost {
    // Existing deterministic IDs identify the illustration without rewriting
    // immutable publications, inferring from titles, or reading private history.
    const badgeId = post.kind === 'badge' ? ALL_BADGE_IDS.find(id => hash([post.ownerEmail, 'badge', id]) === post._id) : undefined;
    return { id: post._id, owner, kind: post.kind, ...(badgeId ? { badgeId } : {}), title: post.title, detail: post.detail, description: typeof post.description === 'string' ? post.description : '', hasWorkoutDetails: post.kind === 'workout' && validSnapshot(post.workoutSnapshot), createdAt: post.createdAt.toISOString(), cheers: post.cheerers.length, cheered: post.cheerers.includes(this.user.email) };
  }
  async workoutDetail(postId: string): Promise<SocialWorkoutDetail> {
    if (!validSocialId(postId)) fail(400, 'Publicación inválida.');
    const post = await this.posts.findOne({ _id: postId });
    if (!post || (post.ownerEmail !== this.user.email && !await this.isFriend(post.ownerEmail))) fail(404, 'Publicación no disponible.');
    if (post.kind !== 'workout') fail(400, 'Esta publicación no es un entrenamiento.');
    if (!validSnapshot(post.workoutSnapshot)) fail(410, 'Esta publicación antigua no incluye el detalle. El autor puede eliminarla y volver a compartir el entrenamiento.');
    return { userEmail: this.user.email, post: this.postDto(post, await this.person(post.ownerEmail)), workout: snapshot(post.workoutSnapshot) };
  }
  async dashboard(): Promise<SocialDashboard> {
    const relationships = await this.relationships.find({ members: this.user.email, state: { $in: ['accepted', 'pending'] } }).sort({ updatedAt: -1 }).limit(100).toArray();
    const friendEmails = relationships.filter((entry) => entry.state === 'accepted').map((entry) => entry.members.find((email) => email !== this.user.email)!).filter(Boolean);
    const emails = [this.user.email, ...friendEmails];
    const profiles = await this.profiles.find({ _id: { $in: emails } }).limit(101).toArray();
    const people = new Map<string, AuthUser>();
    const persons: SocialPerson[] = [];
    const goals: SocialGoal[] = [];
    for (const email of emails) {
      const owner = await this.person(email); people.set(email, owner);
      const profile = profiles.find((entry) => entry._id === email);
      const sharing = profile?.sharing === true;
      const visibleGoals = (profile?.goals ?? []).slice(0, 10).filter((goal) => email === this.user.email || goal.shared);
      const ownerLogs = email === this.user.email || sharing || visibleGoals.length ? await this.logs(email) : [];
      persons.push({ ...owner, sharing, stats: email === this.user.email || sharing ? computeSocialStats(ownerLogs, this.now) : null });
      goals.push(...visibleGoals.map((goal) => ({ ...goal, owner, progress: Math.min(goal.target, goalProgress(ownerLogs, goal.startDate, goal.endDate)) })));
    }
    const storedPosts = await this.posts.find({ ownerEmail: { $in: emails } }).sort({ createdAt: -1, _id: -1 }).limit(50).toArray();
    const posts: SocialPost[] = storedPosts.map((post) => this.postDto(post, people.get(post.ownerEmail)!));
    return {
      userEmail: this.user.email, me: persons[0], friends: persons.slice(1), goals, posts,
      invitations: relationships.filter((entry) => entry.state === 'pending').map((entry) => ({ id: entry.invitationId, from: entry.from, toEmail: entry.toEmail, createdAt: entry.createdAt.toISOString(), direction: entry.from.email === this.user.email ? 'outgoing' : 'incoming' })),
    };
  }
}
