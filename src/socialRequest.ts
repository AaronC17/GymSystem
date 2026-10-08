import { ApiError } from './api';

export const SOCIAL_REQUEST_TIMEOUT_MS = 12_000;

// Do not depend on a transport honoring AbortSignal: a cold dev function or a
// stalled response must not keep the view disabled forever.
export async function boundedSocialRequest<T>(request: () => Promise<T>, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const boundary = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('Solicitud cancelada.', 'AbortError'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) { onAbort(); return; }
    timer = setTimeout(() => {
      reject(new ApiError('Amigos tardó demasiado en responder. Pulsa Actualizar para intentarlo de nuevo.', 504));
      controller.abort();
    }, SOCIAL_REQUEST_TIMEOUT_MS);
  });
  try {
    if (controller.signal.aborted) return await boundary;
    return await Promise.race([Promise.resolve().then(request), boundary]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}
