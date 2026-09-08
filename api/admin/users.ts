import { resolveRegisteredAccount, resolveSessionAccess } from '../_lib/access.js';
import { hasValidOrigin, setPrivateResponse } from '../_lib/session.js';
import { activateUserPayment, listUsers, normalizeEmail, type RegisteredUser } from '../_lib/users.js';
import type { VercelRequest, VercelResponse } from '../_lib/vercel.js';

function readBody(req: VercelRequest) {
  if (typeof req.body === 'string') return JSON.parse(req.body) as unknown;
  return req.body as unknown;
}

function serializeUser(account: RegisteredUser, now: Date) {
  const { access } = resolveRegisteredAccount(account, now);
  return {
    email: account.email,
    nombre: account.name,
    createdAt: account.createdAt.toISOString(),
    trialEndsAt: account.trialEndsAt.toISOString(),
    paidAt: account.paidAt?.toISOString() ?? null,
    status: access.status,
    trialDaysRemaining: access.trialDaysRemaining,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);

  try {
    const admin = await resolveSessionAccess(req);
    if (!admin?.access.isAdmin) return res.status(403).json({ message: 'Acceso no autorizado.' });

    if (req.method === 'GET') {
      const now = new Date();
      const users = await listUsers();
      return res.status(200).json({ users: users.map((user) => serializeUser(user, now)) });
    }

    if (req.method === 'PATCH') {
      if (!hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });
      let body: { email?: unknown };
      try {
        body = readBody(req) as typeof body;
      } catch {
        return res.status(400).json({ message: 'La solicitud no es válida.' });
      }
      if (typeof body?.email !== 'string' || !normalizeEmail(body.email)) {
        return res.status(400).json({ message: 'Ingresa un correo válido.' });
      }
      const account = await activateUserPayment(body.email, admin.user.email);
      if (!account) return res.status(404).json({ message: 'La cuenta no existe.' });
      return res.status(200).json({ user: serializeUser(account, new Date()) });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ message: 'Método no permitido.' });
  } catch (error) {
    console.error('Admin users API error', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'No fue posible administrar los usuarios.' });
  }
}
