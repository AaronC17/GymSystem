import type { Collection } from 'mongodb';
import { isStoredState } from '../src/stateSchema.js';
import type { AppState, StateMutation } from '../src/types.js';
import { resolveSessionAccess } from './_lib/access.js';
import { getDatabase } from './_lib/mongo.js';
import { hasValidOrigin, setPrivateResponse } from './_lib/session.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

const AARON_EMAIL = 'contrerasaaron447@gmail.com';

type UserStateDocument = {
  _id: string;
  state: AppState;
  revision: number;
  appliedMutationIds: string[];
  createdAt: Date;
  updatedAt: Date;
  migratedAt: Date;
};

function createEmptyState(): AppState {
  return { routine: { id: 'routine-empty', name: '', days: [] }, logs: [], unit: 'kg' };
}

function readBody(req: VercelRequest) {
  if (typeof req.body === 'string') return JSON.parse(req.body) as unknown;
  return req.body as unknown;
}

function isMutation(value: unknown): value is StateMutation {
  if (!value || typeof value !== 'object') return false;
  const mutation = value as Partial<StateMutation> & Record<string, unknown>;
  if (typeof mutation.id !== 'string' || mutation.id.length < 8 || mutation.id.length > 120) return false;
  if (mutation.type === 'deleteRoutine') return true;
  if (mutation.type === 'setUnit') return mutation.unit === 'kg' || mutation.unit === 'lb';
  if (mutation.type === 'setRoutine') {
    return isStoredState({ ...createEmptyState(), routine: mutation.routine });
  }
  if (mutation.type === 'upsertWorkout') {
    return isStoredState({ ...createEmptyState(), logs: [mutation.log] });
  }
  return false;
}

function applyMutation(state: AppState, mutation: StateMutation): AppState {
  if (mutation.type === 'setRoutine') return { ...state, routine: mutation.routine };
  if (mutation.type === 'setUnit') return { ...state, unit: mutation.unit };
  if (mutation.type === 'deleteRoutine') return { ...state, routine: createEmptyState().routine };
  return {
    ...state,
    logs: [
      ...state.logs.filter((entry) => !(entry.date === mutation.log.date && entry.routineDayId === mutation.log.routineDayId)),
      mutation.log,
    ],
  };
}

async function getCollection(): Promise<Collection<UserStateDocument>> {
  const database = await getDatabase();
  return database.collection<UserStateDocument>('userStates');
}

async function mutateState(collection: Collection<UserStateDocument>, email: string, mutation: StateMutation) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await collection.findOne({ _id: email });
    if (!current) return null;
    if (current.appliedMutationIds.includes(mutation.id)) return current;
    const state = applyMutation(current.state, mutation);
    if (!isStoredState(state)) throw new Error('Invalid resulting state.');
    const revision = current.revision + 1;
    const appliedMutationIds = [...current.appliedMutationIds.slice(-99), mutation.id];
    const updatedAt = new Date();
    const result = await collection.updateOne(
      { _id: email, revision: current.revision },
      { $set: { state, revision, appliedMutationIds, updatedAt } },
    );
    if (result.modifiedCount === 1) return { ...current, state, revision, appliedMutationIds, updatedAt };
  }
  throw new Error('Concurrent state update limit reached.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);

  try {
    const account = await resolveSessionAccess(req);
    if (!account) return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    const { user, access } = account;
    if (req.method !== 'GET' && !hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });
    if ((req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH') && access.status === 'expired') {
      return res.status(402).json({ message: 'Tu prueba de 14 días finalizó.', access });
    }

    const collection = await getCollection();

    if (req.method === 'GET') {
      const document = await collection.findOne({ _id: user.email });
      return res.status(200).json({ state: document?.state ?? null, revision: document?.revision ?? null });
    }

    if (req.method === 'POST') {
      const body = readBody(req) as { state?: unknown };
      const candidate = body?.state;
      if (!isStoredState(candidate)) return res.status(400).json({ message: 'Los datos locales no tienen un formato válido.' });
      if (user.email === AARON_EMAIL && !candidate.logs.some((log) => log.completed)) {
        return res.status(409).json({ message: 'Abre Safari con el entrenamiento completado para realizar la migración inicial.' });
      }
      const now = new Date();
      const document: UserStateDocument = {
        _id: user.email,
        state: candidate,
        revision: 1,
        appliedMutationIds: [],
        createdAt: now,
        updatedAt: now,
        migratedAt: now,
      };
      try {
        await collection.insertOne(document);
        return res.status(201).json({ state: document.state, revision: document.revision });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
          const current = await collection.findOne({ _id: user.email });
          return res.status(409).json({
            message: 'Esta cuenta ya fue sincronizada desde otro navegador.',
            state: current?.state ?? null,
            revision: current?.revision ?? null,
          });
        }
        throw error;
      }
    }

    if (req.method === 'PATCH') {
      const mutation = readBody(req);
      if (!isMutation(mutation)) return res.status(400).json({ message: 'El cambio solicitado no es válido.' });
      const document = await mutateState(collection, user.email, mutation);
      if (!document) return res.status(409).json({ message: 'Primero debes sincronizar los datos de esta cuenta.' });
      return res.status(200).json({ state: document.state, revision: document.revision });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ message: 'Método no permitido.' });
  } catch (error) {
    console.error('State API error', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'No fue posible acceder a los datos sincronizados.' });
  }
}
