import { resolveSessionAccess } from './_lib/access.js';
import { getDatabase } from './_lib/mongo.js';
import { hasValidOrigin, setPrivateResponse } from './_lib/session.js';
import { normalizedSocialEmail, parseSocialAction, SocialError, SocialService, validSocialId } from './_lib/social.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setPrivateResponse(res);
  res.setHeader('Vary', 'Cookie, X-Kyon-User-Email');
  try {
    const account = await resolveSessionAccess(req);
    if (!account) return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    const expectedOwner = req.headers['x-kyon-user-email'];
    if (typeof expectedOwner !== 'string' || expectedOwner.trim().toLowerCase() !== account.user.email) return res.status(409).json({ code: 'SESSION_OWNER_MISMATCH', message: 'La sesión cambió de usuario. Inicia sesión de nuevo.' });
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ message: 'Método no permitido.' });
    }
    if (req.method === 'POST' && !hasValidOrigin(req)) return res.status(403).json({ message: 'Origen no permitido.' });
    if (account.access.status === 'expired') return res.status(402).json({ message: 'Tu prueba de 14 días finalizó.', access: account.access });
    const action = req.method === 'POST' ? parseSocialAction(req.body) : null;
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const emails = req.method === 'GET' ? params.getAll('email') : [];
    const postIds = req.method === 'GET' ? params.getAll('postId') : [];
    if (postIds.length && (emails.length || postIds.length !== 1 || !validSocialId(postIds[0]))) throw new SocialError(400, 'Publicación inválida.');
    const lookup = emails.length > 0;
    const email = emails.length === 1 ? normalizedSocialEmail(emails[0]) : null;
    if (lookup && !email) throw new SocialError(400, 'Ingresa un correo válido.');
    const service = new SocialService(await getDatabase(), account.user);
    if (postIds.length) return res.status(200).json(await service.workoutDetail(postIds[0]));
    if (email) return res.status(200).json(await service.lookup(email));
    if (action) await service.act(action);
    return res.status(200).json(await service.dashboard());
  } catch (error) {
    if (error instanceof SocialError) return res.status(error.status).json({ message: error.message });
    // Do not log database errors, request bodies, or addresses.
    return res.status(500).json({ message: 'No fue posible acceder a Amigos. Inténtalo de nuevo.' });
  }
}
