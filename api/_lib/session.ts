import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '../../src/types.js';
import type { VercelRequest, VercelResponse } from './vercel.js';

const COOKIE_NAME = 'kyon-session';
const SESSION_SECONDS = 60 * 60 * 12;
const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = AuthUser & { exp: number };
type SessionIdentity = { email: string };

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  return secret;
}

function sign(value: string) {
  return createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries((header ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return key ? [[key, decodeURIComponent(value)]] : [];
  }));
}

export function createSession(user: AuthUser, remember: boolean) {
  const maxAge = remember ? REMEMBERED_SESSION_SECONDS : SESSION_SECONDS;
  const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + maxAge };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${sign(encoded)}`, maxAge };
}

export function readSession(req: VercelRequest): SessionIdentity | null {
  let token: string | undefined;
  try {
    token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  } catch {
    return null;
  }
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = Buffer.from(sign(encoded));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.email !== 'string' || typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) return null;
    const email = payload.email.trim().toLowerCase();
    return email ? { email } : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: VercelResponse, token: string, remember: boolean, maxAge: number) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    process.env.VERCEL_ENV === 'development' ? '' : 'Secure',
    remember ? `Max-Age=${maxAge}` : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function setPrivateResponse(res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
}

export function hasValidOrigin(req: VercelRequest) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
