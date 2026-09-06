import { authenticateAccount } from './_lib/accounts.js';
import {
  clearSessionCookie,
  createSession,
  hasValidOrigin,
  readSession,
  setPrivateResponse,
  setSessionCookie,
} from './_lib/session.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

function readBody(req: VercelRequest) {
  if (typeof req.body === 'string') return JSON.parse(req.body) as unknown;
  return req.body as unknown;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);

  if (req.method === 'GET') {
    const user = readSession(req);
    return user ? res.status(200).json({ user }) : res.status(401).json({ message: 'Inicia sesión para continuar.' });
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

  try {
    const body = readBody(req) as { email?: unknown; password?: unknown; remember?: unknown };
    if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
      return res.status(400).json({ message: 'Ingresa tu correo y contraseña.' });
    }
    const account = authenticateAccount(body.email, body.password);
    if (!account) return res.status(401).json({ message: 'Las credenciales no coinciden.' });
    const user = { email: account.email, name: account.name };
    const session = createSession(user, body.remember === true);
    setSessionCookie(res, session.token, body.remember === true, session.maxAge);
    return res.status(200).json({ user });
  } catch {
    return res.status(400).json({ message: 'No fue posible procesar el inicio de sesión.' });
  }
}
