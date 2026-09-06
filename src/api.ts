import type { AppState, AuthUser, StateMutation } from './types';

type SessionResponse = { user: AuthUser };

export type RemoteStateResponse = {
  state: AppState | null;
  revision: number | null;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type MutationInput = StateMutation extends infer Mutation
  ? Mutation extends { id: string } ? Omit<Mutation, 'id'> : never
  : never;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
  if (!response.ok) throw new ApiError(payload?.message ?? 'No fue posible conectar con el servidor.', response.status);
  return payload as T;
}

export function createMutation(mutation: MutationInput): StateMutation {
  return {
    ...mutation,
    id: globalThis.crypto?.randomUUID?.() ?? `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  } as StateMutation;
}

export function loginRemote(email: string, password: string, remember: boolean) {
  return request<SessionResponse>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email, password, remember }),
  });
}

export function getRemoteSession() {
  return request<SessionResponse>('/api/session');
}

export function logoutRemote() {
  return request<{ ok: true }>('/api/session', { method: 'DELETE' });
}

export function getRemoteState() {
  return request<RemoteStateResponse>('/api/state');
}

export function bootstrapRemoteState(state: AppState) {
  return request<RemoteStateResponse>('/api/state', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
}

export function mutateRemoteState(mutation: StateMutation) {
  return request<RemoteStateResponse>('/api/state', {
    method: 'PATCH',
    body: JSON.stringify(mutation),
  });
}
