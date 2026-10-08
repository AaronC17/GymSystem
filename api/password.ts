import { resolveAccountAccess } from './_lib/access.js';
import { credentialMatchesSession, lookupCredential, replaceCredential, verifyCredentialPassword } from './_lib/credentials.js';
import { clearSessionCookie, hasValidOrigin, readSession, setPrivateResponse } from './_lib/session.js';
import { normalizeEmail } from './_lib/users.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Método no permitido.' });
  }
  if (!hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });

  try {
    const session = readSession(req);
    if (!session) return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    const owner = req.headers['x-kyon-user-email'];
    if (typeof owner !== 'string' || normalizeEmail(owner) !== session.email) {
      return res.status(403).json({ message: 'La cuenta no coincide con la sesión.' });
    }
    let body: { currentPassword?: unknown; newPassword?: unknown };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as typeof body;
    } catch {
      return res.status(400).json({ message: 'Datos de contraseña inválidos.' });
    }
    if (typeof body?.currentPassword !== 'string' || !body.currentPassword.length || body.currentPassword.length > 256
      || typeof body.newPassword !== 'string' || body.newPassword.length < 8 || body.newPassword.length > 128
      || !/\p{L}/u.test(body.newPassword) || !/\d/.test(body.newPassword)) {
      return res.status(400).json({ message: 'La nueva contraseña debe tener entre 8 y 128 caracteres, una letra y un número.' });
    }
    const credential = await lookupCredential(session.email);
    if (!credentialMatchesSession(credential, session.credentialVersion)
      || !await resolveAccountAccess(session.email)) {
      return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    }
    if (!await verifyCredentialPassword(session.email, body.currentPassword, credential)) {
      return res.status(401).json({ message: 'La contraseña actual no coincide.' });
    }
    if (!await replaceCredential(session.email, body.newPassword, credential)) {
      return res.status(409).json({ message: 'La contraseña cambió en otra solicitud. Inicia sesión nuevamente.' });
    }
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch {
    // Never log request contents, database errors, hashes or passwords.
    console.error('Password API error');
    return res.status(500).json({ message: 'No fue posible cambiar la contraseña.' });
  }
}
