import { resolveLegacyAccount, resolveRegisteredAccount, resolveSessionAccess } from './_lib/access.js';
import { authenticateAccount, findAccount } from './_lib/accounts.js';
import {
  clearSessionCookie,
  createSession,
  hasValidOrigin,
  setPrivateResponse,
  setSessionCookie,
} from './_lib/session.js';
import { authenticateUser } from './_lib/users.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

function readBody(req: VercelRequest) {
  if (typeof req.body === 'string') return JSON.parse(req.body) as unknown;
  return req.body as unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);

  if (req.method === 'GET') {
    try {
      const account = await resolveSessionAccess(req);
      return account
        ? res.status(200).json(account)
        : res.status(401).json({ message: 'Inicia sesión para continuar.' });
    } catch (error) {
      console.error('Session API error', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'No fue posible consultar la sesión.' });
    }
  }

  if (req.method === 'DELETE') {
    if (!hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ message: 'Método no permitido.' });
  }
  if (!hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });

  let body: { email?: unknown; password?: unknown; remember?: unknown };
  try {
    body = readBody(req) as typeof body;
  } catch {
    return res.status(400).json({ message: 'No fue posible procesar el inicio de sesión.' });
  }
  if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
    return res.status(400).json({ message: 'Ingresa tu correo y contraseña.' });
  }

  try {
    const legacy = findAccount(body.email);
    let resolved;
    if (legacy) {
      const account = authenticateAccount(body.email, body.password);
      if (!account) return res.status(401).json({ message: 'Las credenciales no coinciden.' });
      resolved = resolveLegacyAccount(account);
    } else {
      const account = body.email.length <= 254 && body.password.length <= 128
        ? await authenticateUser(body.email, body.password)
        : null;
      if (!account) return res.status(401).json({ message: 'Las credenciales no coinciden.' });
      resolved = resolveRegisteredAccount(account);
    }
    const session = createSession(resolved.user, body.remember === true);
    setSessionCookie(res, session.token, body.remember === true, session.maxAge);
    return res.status(200).json(resolved);
  } catch (error) {
    console.error('Session API error', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'No fue posible procesar el inicio de sesión.' });
  }
}
