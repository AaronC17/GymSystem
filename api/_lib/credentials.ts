import { randomBytes, scrypt } from 'node:crypto';
import { findAccount, authenticateAccount } from './accounts.js';
import { getDatabase } from './mongo.js';
import { verifyAccountPassword } from './password.js';
import { authenticateUser, normalizeEmail } from './users.js';

export type AccountCredential = {
  _id: string;
  passwordSalt: string;
  passwordHash: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
};

async function collection() {
  return (await getDatabase()).collection<AccountCredential>('accountCredentials');
}

export async function lookupCredential(email: string) {
  return (await collection()).findOne({ _id: normalizeEmail(email) });
}

export async function verifyCredentialPassword(email: string, password: string, credential: AccountCredential | null) {
  if (password.length > 256) return false;
  // An override is authoritative, even if its contents are invalid. Never fall
  // back to the original credential once an override exists.
  if (credential) {
    if (!/^[a-f\d]{128}$/i.test(credential.passwordHash) || !/^[a-f\d]{32}$/i.test(credential.passwordSalt)) return false;
    return verifyAccountPassword(password, credential.passwordSalt, credential.passwordHash);
  }
  return findAccount(email)
    ? Boolean(await authenticateAccount(email, password))
    : password.length <= 128 && Boolean(await authenticateUser(email, password));
}

export async function isCurrentCredentialVersion(email: string, version?: string) {
  const credential = await lookupCredential(email);
  return credentialMatchesSession(credential, version);
}

export function credentialMatchesSession(credential: AccountCredential | null, version?: string) {
  return credential
    ? typeof credential.version === 'string' && /^[a-f\d]{32}$/.test(credential.version) && credential.version === version
    : version === undefined;
}

/** Only called for an explicit password-change request; never migrates users. */
export async function replaceCredential(email: string, password: string, previous: AccountCredential | null) {
  const passwordSalt = randomBytes(16).toString('hex');
  const passwordHash = await new Promise<string>((resolve, reject) => {
    scrypt(password, passwordSalt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
  const now = new Date();
  const document: AccountCredential = {
    _id: normalizeEmail(email), passwordSalt, passwordHash,
    version: randomBytes(16).toString('hex'),
    createdAt: previous?.createdAt ?? now, updatedAt: now,
  };
  const credentials = await collection();
  if (previous) {
    const result = await credentials.updateOne(
      { _id: document._id, version: previous.version },
      { $set: { passwordSalt, passwordHash, version: document.version, updatedAt: now } },
    );
    return result.matchedCount === 1;
  }
  try {
    await credentials.insertOne(document);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false;
    throw error;
  }
}
