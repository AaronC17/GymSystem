import type { AccessInfo, AppState, AuthUser, StateMutation } from './types';
import { isStoredState } from './stateSchema';
import { normalizeUserEmail } from './syncSession';
import { isSocialDashboard, isSocialPost } from './socialSchema';
import type { SocialAction, SocialDashboard, SocialWorkoutDetail } from './socialTypes';

export type SessionResponse = { user: AuthUser; access: AccessInfo };

export type AdminUserSummary = {
  email: string;
  nombre: string;
  createdAt: string;
  trialEndsAt: string;
  paidAt: string | null;
  status: AccessInfo['status'];
  trialDaysRemaining: number;
};

export type RemoteStateResponse = {
  state: AppState | null;
  revision: number | null;
  userEmail: string;
};

export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };
export type StateRequestOptions = RequestOptions & { userEmail: string };

export const STATE_OWNER_HEADER = 'X-Kyon-User-Email';

export class ApiError extends Error {
  status: number;
  access?: AccessInfo;
  code?: string;

  constructor(message: string, status: number, access?: AccessInfo, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.access = access;
    this.code = code;
  }
}

export class ApiResponseError extends ApiError {
  constructor(message = 'El servidor devolvió una respuesta inválida. Tus cambios locales se conservan.') {
    super(message, 200);
    this.name = 'ApiResponseError';
  }
}

export class ApiOwnershipError extends ApiError {
  constructor() {
    super('La sesión cambió de usuario. Inicia sesión de nuevo para sincronizar.', 401, undefined, 'SESSION_OWNER_MISMATCH');
    this.name = 'ApiOwnershipError';
  }
}

type MutationInput = StateMutation extends infer Mutation
  ? Mutation extends { id: string } ? Omit<Mutation, 'id'> : never
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isAccessInfo(value: unknown): value is AccessInfo {
  return isRecord(value) && (value.status === 'trial' || value.status === 'active' || value.status === 'expired') &&
    (value.trialEndsAt === null || isDateString(value.trialEndsAt)) &&
    Number.isInteger(value.trialDaysRemaining) && Number(value.trialDaysRemaining) >= 0 &&
    typeof value.isAdmin === 'boolean';
}

function decodeSession(payload: unknown): SessionResponse {
  if (!isRecord(payload) || !isRecord(payload.user) ||
    typeof payload.user.name !== 'string' || !payload.user.name.trim() ||
    typeof payload.user.email !== 'string' || !payload.user.email.trim() || !isAccessInfo(payload.access)) {
    throw new ApiResponseError();
  }
  return { user: { name: payload.user.name, email: normalizeUserEmail(payload.user.email) }, access: payload.access };
}

function validState(value: unknown): value is AppState {
  try {
    if (!isStoredState(value)) return false;
    // Protect consumers even while older schema versions accepted optional objects / coerced dates.
    return (value.routine.sourceName === undefined || typeof value.routine.sourceName === 'string') &&
      value.routine.days.every((day) => day.exercises.every((exercise) =>
        [exercise.note, exercise.muscle, exercise.link].every((field) => field === undefined || typeof field === 'string'),
      )) && value.logs.every((log) => typeof log.date === 'string');
  } catch {
    return false;
  }
}

function decodeRemoteState(payload: unknown, expectedEmail: string, allowEmpty: boolean): RemoteStateResponse {
  if (!isRecord(payload)) throw new ApiResponseError();
  if (typeof payload.userEmail !== 'string' || !payload.userEmail.trim()) {
    throw new ApiResponseError('El servidor aún no puede verificar el propietario de los datos. La cola local se conserva.');
  }
  const userEmail = normalizeUserEmail(payload.userEmail);
  if (userEmail !== normalizeUserEmail(expectedEmail)) throw new ApiOwnershipError();
  if (payload.state === null) {
    if (!allowEmpty || payload.revision !== null) throw new ApiResponseError();
    return { state: null, revision: null, userEmail };
  }
  if (!validState(payload.state) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) {
    throw new ApiResponseError();
  }
  return { state: payload.state, revision: Number(payload.revision), userEmail };
}

function isAdminUser(value: unknown): value is AdminUserSummary {
  return isRecord(value) && typeof value.email === 'string' && typeof value.nombre === 'string' &&
    isDateString(value.createdAt) && isDateString(value.trialEndsAt) &&
    (value.paidAt === null || isDateString(value.paidAt)) &&
    (value.status === 'trial' || value.status === 'active' || value.status === 'expired') &&
    Number.isInteger(value.trialDaysRemaining) && Number(value.trialDaysRemaining) >= 0;
}

async function request<T>(path: string, decode: (payload: unknown) => T, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('La solicitud fue cancelada.', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 20000);
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', headers, signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new DOMException('La solicitud fue cancelada.', 'AbortError');
    if (!response.ok) {
      const access = isRecord(payload) && isAccessInfo(payload.access) ? payload.access : undefined;
      const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'No fue posible conectar con el servidor.';
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined;
      throw new ApiError(message, response.status, access, code);
    }
    return decode(payload);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function ownerHeaders(options: StateRequestOptions) {
  const email = normalizeUserEmail(options.userEmail);
  if (!email) throw new ApiOwnershipError();
  // The backend MUST compare this header with the authenticated session before any read/write.
  return { [STATE_OWNER_HEADER]: email };
}

export function createMutation(mutation: MutationInput): StateMutation {
  return {
    ...mutation,
    id: globalThis.crypto?.randomUUID?.() ?? `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  } as StateMutation;
}

export function loginRemote(email: string, password: string, remember: boolean) {
  return request('/api/session', (payload) => {
    const session = decodeSession(payload);
    if (session.user.email !== normalizeUserEmail(email)) throw new ApiOwnershipError();
    return session;
  }, {
    method: 'POST',
    body: JSON.stringify({ email, password, remember }),
  });
}

export function getRemoteSession(options: RequestOptions = {}) {
  return request('/api/session', decodeSession, undefined, options);
}

export function registerRemote(name: string, email: string, password: string) {
  return request('/api/register', (payload) => {
    const session = decodeSession(payload);
    if (session.user.email !== normalizeUserEmail(email)) throw new ApiOwnershipError();
    return session;
  }, {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export function logoutRemote() {
  return request('/api/session', (payload): { ok: true } => {
    if (!isRecord(payload) || payload.ok !== true) throw new ApiResponseError();
    return { ok: true };
  }, { method: 'DELETE' });
}

export function changePasswordRemote(currentPassword: string, newPassword: string, options: StateRequestOptions) {
  return request('/api/password', (payload): { ok: true } => {
    if (!isRecord(payload) || payload.ok !== true) throw new ApiResponseError();
    return { ok: true };
  }, {
    method: 'POST',
    headers: ownerHeaders(options),
    body: JSON.stringify({ currentPassword, newPassword }),
  }, options);
}

export function getRemoteState(options: StateRequestOptions) {
  return request('/api/state', (payload) => decodeRemoteState(payload, options.userEmail, true), { headers: ownerHeaders(options) }, options);
}

function decodeSocial(payload: unknown, email: string): SocialDashboard {
  if (!isSocialDashboard(payload)) throw new ApiResponseError('La respuesta de Amigos no tiene un formato válido.');
  if (normalizeUserEmail(payload.userEmail) !== normalizeUserEmail(email) || normalizeUserEmail(payload.me.email) !== normalizeUserEmail(email)) throw new ApiOwnershipError();
  return payload;
}

export function getSocialDashboard(options: StateRequestOptions) {
  return request('/api/social', payload => decodeSocial(payload, options.userEmail), { headers: ownerHeaders(options) }, options);
}

export function findSocialPerson(email: string, options: StateRequestOptions): Promise<AuthUser[]> {
  return request(`/api/social?email=${encodeURIComponent(email.trim().toLowerCase())}`, payload => {
    if (!isRecord(payload) || typeof payload.userEmail !== 'string' || !Array.isArray(payload.people) || payload.people.length > 1 || !payload.people.every(p => isRecord(p) && typeof p.email === 'string' && p.email === email.trim().toLowerCase() && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 200)) throw new ApiResponseError();
    if (normalizeUserEmail(payload.userEmail) !== normalizeUserEmail(options.userEmail)) throw new ApiOwnershipError();
    return payload.people as AuthUser[];
  }, { headers: ownerHeaders(options) }, options);
}

export function getSocialWorkoutDetail(postId: string, options: StateRequestOptions): Promise<SocialWorkoutDetail> {
  return request(`/api/social?postId=${encodeURIComponent(postId)}`, payload => {
    if (!isRecord(payload) || typeof payload.userEmail !== 'string' || !isSocialPost(payload.post) || payload.post.id !== postId || payload.post.kind !== 'workout' || !payload.post.hasWorkoutDetails ||
      !validState({ routine: { id: 'routine-empty', name: '', days: [] }, logs: [payload.workout], unit: 'kg' }) || !isRecord(payload.workout) || payload.workout.completed !== true) throw new ApiResponseError('El detalle del entrenamiento no tiene un formato válido.');
    if (normalizeUserEmail(payload.userEmail) !== normalizeUserEmail(options.userEmail)) throw new ApiOwnershipError();
    return payload as SocialWorkoutDetail;
  }, { headers: ownerHeaders(options) }, options);
}

export function actSocial(action: SocialAction, options: StateRequestOptions) {
  return request('/api/social', payload => decodeSocial(payload, options.userEmail), {
    method: 'POST', headers: ownerHeaders(options), body: JSON.stringify(action),
  }, options);
}

export function bootstrapRemoteState(state: AppState, options: StateRequestOptions) {
  return request('/api/state', (payload) => decodeRemoteState(payload, options.userEmail, false), {
    method: 'POST',
    headers: ownerHeaders(options),
    body: JSON.stringify({ state }),
  }, options);
}

export function mutateRemoteState(mutation: StateMutation, options: StateRequestOptions) {
  return request('/api/state', (payload) => decodeRemoteState(payload, options.userEmail, false), {
    method: 'PATCH',
    headers: ownerHeaders(options),
    body: JSON.stringify(mutation),
  }, options);
}

export function getAdminUsers() {
  return request('/api/admin/users', (payload): { users: AdminUserSummary[] } => {
    if (!isRecord(payload) || !Array.isArray(payload.users) || !payload.users.every(isAdminUser)) throw new ApiResponseError();
    return { users: payload.users };
  });
}

export function activateAdminUser(email: string) {
  return request('/api/admin/users', (payload): { user: AdminUserSummary } => {
    if (!isRecord(payload) || !isAdminUser(payload.user)) throw new ApiResponseError();
    return { user: payload.user };
  }, {
    method: 'PATCH',
    body: JSON.stringify({ email }),
  });
}
