import { getDatabase } from './_lib/mongo.js';
import type { VercelRequest, VercelResponse } from './_lib/vercel.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const database = await getDatabase();
    await database.command({ ping: 1 });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false });
  }
}
