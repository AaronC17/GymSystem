import { createInitialState } from './data';
import { isStoredState } from './stateSchema';
import { abortableSyncDelay, normalizeUserEmail } from './syncSession';
import type { AppState, StateMutation } from './types';

export type SyncStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type SyncRemoteState = { state: AppState; revision: number; userEmail: string };
export type SyncRequestContext = { userEmail: string; signal: AbortSignal };

type SyncSnapshot = {
  version: 1;
  userEmail: string;
  baseState: AppState;
  revision: number | null;
  pending: StateMutation[];
};

export class SyncStorageError extends Error {
  constructor(message = 'No se pudo guardar el cambio en este dispositivo. Libera espacio e inténtalo de nuevo.') {
    super(message);
    this.name = 'SyncStorageError';
  }
}

export function syncOutboxKey(email: string) {
  return `kyon-sync-outbox-v1:${normalizeUserEmail(email)}`;
}

export function syncMigrationBackupKey(email: string) {
  return `kyon-sync-migration-backup-v1:${normalizeUserEmail(email)}`;
}

export function saveMigrationBackup(storage: SyncStorage, email: string, state: AppState) {
  try {
    const key = syncMigrationBackupKey(email);
    // Never replace the original candidate with a conflicting remote response.
    if (storage.getItem(key) === null) storage.setItem(key, JSON.stringify(state));
  } catch {
    throw new SyncStorageError('No se pudo respaldar la copia local. La migración no se realizará todavía.');
  }
}

export function applySyncMutation(state: AppState, mutation: StateMutation): AppState {
  if (mutation.type === 'setRoutine') return { ...state, routine: mutation.routine };
  if (mutation.type === 'setUnit') return { ...state, unit: mutation.unit };
  if (mutation.type === 'deleteRoutine') return { ...state, routine: createInitialState().routine };
  return {
    ...state,
    logs: [
      ...state.logs.filter((log) => !(log.date === mutation.log.date && log.routineDayId === mutation.log.routineDayId)),
      mutation.log,
    ],
  };
}

export function replaySyncMutations(state: AppState, pending: readonly StateMutation[]) {
  return pending.reduce(applySyncMutation, state);
}

function validState(value: unknown): value is AppState {
  try {
    return isStoredState(value);
  } catch {
    return false;
  }
}

function validMutation(value: unknown): value is StateMutation {
  if (!value || typeof value !== 'object') return false;
  const mutation = value as Partial<StateMutation>;
  if (typeof mutation.id !== 'string' || mutation.id.length < 8 || mutation.id.length > 120) return false;
  if (mutation.type === 'deleteRoutine') return true;
  if (mutation.type === 'setUnit') return mutation.unit === 'kg' || mutation.unit === 'lb';
  if (mutation.type === 'setRoutine') return validState({ ...createInitialState(), routine: mutation.routine });
  if (mutation.type === 'upsertWorkout') return validState({ ...createInitialState(), logs: [mutation.log] });
  return false;
}

function readSnapshot(storage: SyncStorage, email: string): SyncSnapshot | null {
  let raw: string | null;
  try {
    raw = storage.getItem(syncOutboxKey(email));
  } catch {
    throw new SyncStorageError('No se puede acceder al respaldo local. Tus datos no se han borrado.');
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid snapshot');
    const snapshot = parsed as Partial<SyncSnapshot>;
    if (
      snapshot.version !== 1 || snapshot.userEmail !== normalizeUserEmail(email) ||
      !validState(snapshot.baseState) ||
      !(snapshot.revision === null || (Number.isSafeInteger(snapshot.revision) && Number(snapshot.revision) >= 1)) ||
      !Array.isArray(snapshot.pending) || !snapshot.pending.every(validMutation) ||
      new Set(snapshot.pending.map((mutation) => mutation.id)).size !== snapshot.pending.length
    ) throw new Error('Invalid snapshot');
    if (!validState(replaySyncMutations(snapshot.baseState, snapshot.pending))) throw new Error('Invalid projection');
    return snapshot as SyncSnapshot;
  } catch {
    // An invalid outbox is not equivalent to an empty outbox. Keep the raw backup.
    throw new SyncStorageError('La cola local necesita recuperarse. Su copia original se conserva sin sobrescribir.');
  }
}

/** Read-only startup preview. Does not start a worker, authorize access or write storage. */
export function readProjectedSyncState(storage: SyncStorage, email: string): AppState | null {
  const snapshot = readSnapshot(storage, email);
  return snapshot ? replaySyncMutations(snapshot.baseState, snapshot.pending) : null;
}

type SyncSessionOptions = {
  userEmail: string;
  storage: SyncStorage;
  initialState?: AppState;
  isCurrent: () => boolean;
  send: (mutation: StateMutation, context: SyncRequestContext) => Promise<SyncRemoteState>;
  onState: (state: AppState) => void;
  onError: (reason: unknown) => void;
  shouldRetry?: (reason: unknown) => boolean;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

/** One owner, one lane. The persisted envelope atomically stores the base and outbox. */
export class DurableSyncSession {
  readonly userEmail: string;
  readonly restoredFromStorage: boolean;
  private snapshot: SyncSnapshot;
  private controller = new AbortController();
  private closed = false;
  private remoteReady = false;
  private worker: Promise<void> | null = null;

  constructor(private options: SyncSessionOptions) {
    this.userEmail = normalizeUserEmail(options.userEmail);
    const restored = readSnapshot(options.storage, this.userEmail);
    this.restoredFromStorage = restored !== null;
    this.snapshot = restored ?? {
      version: 1,
      userEmail: this.userEmail,
      baseState: options.initialState ?? createInitialState(),
      revision: null,
      pending: [],
    };
  }

  get state() {
    return replaySyncMutations(this.snapshot.baseState, this.snapshot.pending);
  }

  get pendingCount() {
    return this.snapshot.pending.length;
  }

  get revision() {
    return this.snapshot.revision;
  }

  private isCurrent() {
    return !this.closed && !this.controller.signal.aborted && this.options.isCurrent();
  }

  close() {
    this.closed = true;
    this.controller.abort();
    // Do not clear pending work, nor wait for a fetch implementation that ignores abort.
  }

  private publish(next: SyncSnapshot) {
    if (!this.isCurrent()) return false;
    try {
      this.options.storage.setItem(syncOutboxKey(this.userEmail), JSON.stringify(next));
    } catch {
      throw new SyncStorageError();
    }
    this.snapshot = next;
    if (this.isCurrent()) this.options.onState(this.state);
    return true;
  }

  enqueue(mutation: StateMutation) {
    if (!this.isCurrent()) return false;
    if (!validMutation(mutation)) throw new Error('El cambio solicitado no tiene un formato válido.');
    if (this.snapshot.pending.some((entry) => entry.id === mutation.id)) return true;
    // Detach from editable UI objects before persisting or sending them.
    const detached = JSON.parse(JSON.stringify(mutation)) as StateMutation;
    if (!this.publish({ ...this.snapshot, pending: [...this.snapshot.pending, detached] })) return false;
    void this.flush();
    return true;
  }

  reconcile(remote: SyncRemoteState) {
    if (!this.isCurrent()) return false;
    if (!validState(remote.state) || !Number.isSafeInteger(remote.revision) || remote.revision < 1) {
      throw new Error('El servidor devolvió datos de sincronización inválidos.');
    }
    if (typeof remote.userEmail !== 'string' || normalizeUserEmail(remote.userEmail) !== this.userEmail) {
      throw new Error('La respuesta pertenece a otra cuenta.');
    }
    if (this.snapshot.revision === null || remote.revision >= this.snapshot.revision) {
      if (!this.publish({ ...this.snapshot, baseState: remote.state, revision: remote.revision })) return false;
    }
    this.remoteReady = true;
    void this.flush();
    return true;
  }

  flush(): Promise<void> {
    if (!this.isCurrent() || !this.remoteReady || this.pendingCount === 0) return Promise.resolve();
    if (this.worker) return this.worker;
    const tracked: Promise<void> = this.drain().catch((reason: unknown) => {
      if (this.isCurrent()) this.options.onError(reason);
      return false;
    }).then((completed) => {
      if (this.worker === tracked) this.worker = null;
      // A commit can arrive between the drain finishing and this continuation.
      if (completed && this.isCurrent() && this.pendingCount > 0) return this.flush();
    });
    this.worker = tracked;
    return tracked;
  }

  private async drain() {
    while (this.isCurrent() && this.pendingCount > 0) {
      const mutation = this.snapshot.pending[0];
      let lastError: unknown;
      let acknowledged = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!this.isCurrent()) return false;
        try {
          const remote = await this.options.send(mutation, { userEmail: this.userEmail, signal: this.controller.signal });
          if (!this.isCurrent()) return false;
          if (!validState(remote.state) || !Number.isSafeInteger(remote.revision) || remote.revision < 1 ||
            typeof remote.userEmail !== 'string' || normalizeUserEmail(remote.userEmail) !== this.userEmail) {
            throw new Error('El servidor devolvió datos de sincronización inválidos.');
          }
          const useRemote = this.snapshot.revision === null || remote.revision >= this.snapshot.revision;
          this.publish({
            ...this.snapshot,
            baseState: useRemote ? remote.state : this.snapshot.baseState,
            revision: useRemote ? remote.revision : this.snapshot.revision,
            pending: this.snapshot.pending.filter((entry) => entry.id !== mutation.id),
          });
          acknowledged = true;
          break;
        } catch (reason) {
          if (!this.isCurrent()) return false;
          lastError = reason;
          if (reason instanceof SyncStorageError || this.options.shouldRetry?.(reason) === false || attempt === 2) break;
          await (this.options.delay ?? abortableSyncDelay)(450 * (attempt + 1), this.controller.signal);
        }
      }
      if (!acknowledged) {
        if (this.isCurrent()) this.options.onError(lastError);
        // Keep this mutation and every later one. Never adopt a raw server state over them.
        return false;
      }
    }
    return true;
  }
}
