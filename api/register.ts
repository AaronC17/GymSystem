import { resolveRegisteredAccount } from './_lib/access.js';
import { findAccount } from './_lib/accounts.js';
import {
  createSession,
  hasValidOrigin,
  setPrivateResponse,
  setSessionCookie,
} from './_lib/session.js';
import { createUser, normalizeEmail, UserAlreadyExistsError } from './_lib/users.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

function readBody(req: VercelRequest) {
  if (typeof req.body === 'string') return JSON.parse(req.body) as unknown;
  return req.body as unknown;
}

function isValidEmail(email: string) {
  if (!email || email.length > 254) return false;
  const separator = email.lastIndexOf('@');
  if (separator <= 0 || separator > 64 || separator === email.length - 1) return false;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z\d.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
  ));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Método no permitido.' });
  }
  if (!hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });

  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = readBody(req) as typeof body;
  } catch {
    return res.status(400).json({ message: 'Los datos de registro no son válidos.' });
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (name.length < 2 || name.length > 70) {
    return res.status(400).json({ message: 'El nombre debe tener entre 2 y 70 caracteres.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Ingresa un correo válido.' });
  }
  if (password.length < 8 || password.length > 128 || !/\p{L}/u.test(password) || !/\d/u.test(password)) {
    return res.status(400).json({ message: 'La contraseña debe tener entre 8 y 128 caracteres, una letra y un número.' });
  }
  if (findAccount(email)) {
    return res.status(409).json({ message: 'No fue posible registrar este correo.' });
  }

  try {
    const account = await createUser(email, name, password);
    const resolved = resolveRegisteredAccount(account);
    const session = createSession(resolved.user, true);
    setSessionCookie(res, session.token, true, session.maxAge);
    return res.status(201).json(resolved);
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      return res.status(409).json({ message: 'No fue posible registrar este correo.' });
    }
    console.error('Registration API error', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'No fue posible completar el registro.' });
  }
}
