export type SessionToken = Readonly<{ epoch: number; signal: AbortSignal }>;

/** Every asynchronous continuation must check its token, even if abort was ignored. */
export class SessionEpoch {
  private epoch = 0;
  private controller = new AbortController();

  capture(): SessionToken {
    return { epoch: this.epoch, signal: this.controller.signal };
  }

  isCurrent(token: SessionToken) {
    return token.epoch === this.epoch && !token.signal.aborted;
  }

  advance(): SessionToken {
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch += 1;
    return this.capture();
  }
}

/** Cookie-changing requests stay ordered; aborting a fetch cannot undo a Set-Cookie. */
export class AuthRequestQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function normalizeUserEmail(email: string) {
  return email.trim().toLowerCase();
}

export function abortableSyncDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
