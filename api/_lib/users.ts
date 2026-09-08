import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Collection } from 'mongodb';
import { getDatabase } from './mongo.js';

const SCRYPT_KEY_LENGTH = 64;
const DUMMY_SALT = '00000000000000000000000000000000';

export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
export const PAID_AMOUNT_CRC = 5000;
export const PAID_METHOD = 'SINPE' as const;

type UserDocument = {
  _id: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: Date;
  trialStartedAt: Date;
  trialEndsAt: Date;
  paidAt: Date | null;
  paidAmountCrc: number | null;
  paidMethod: typeof PAID_METHOD | null;
  activatedBy: string | null;
  updatedAt: Date;
};

export type RegisteredUser = {
  email: string;
  name: string;
  createdAt: Date;
  trialStartedAt: Date;
  trialEndsAt: Date;
  paidAt: Date | null;
  paidAmountCrc: number | null;
  paidMethod: typeof PAID_METHOD | null;
  activatedBy: string | null;
  updatedAt: Date;
};

export class UserAlreadyExistsError extends Error {
  constructor() {
    super('User already exists.');
    this.name = 'UserAlreadyExistsError';
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getUsersCollection(): Promise<Collection<UserDocument>> {
  const database = await getDatabase();
  return database.collection<UserDocument>('users');
}

function derivePasswordHash(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function toRegisteredUser(document: UserDocument): RegisteredUser {
  return {
    email: document._id,
    name: document.name,
    createdAt: document.createdAt,
    trialStartedAt: document.trialStartedAt,
    trialEndsAt: document.trialEndsAt,
    paidAt: document.paidAt,
    paidAmountCrc: document.paidAmountCrc,
    paidMethod: document.paidMethod,
    activatedBy: document.activatedBy,
    updatedAt: document.updatedAt,
  };
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000);
}

export async function lookupUser(email: string): Promise<RegisteredUser | null> {
  const collection = await getUsersCollection();
  const document = await collection.findOne(
    { _id: normalizeEmail(email) },
    { projection: { passwordHash: 0, passwordSalt: 0 } },
  );
  return document ? toRegisteredUser(document) : null;
}

export async function createUser(email: string, name: string, password: string): Promise<RegisteredUser> {
  const normalizedEmail = normalizeEmail(email);
  const passwordSalt = randomBytes(16).toString('hex');
  const passwordHash = (await derivePasswordHash(password, passwordSalt)).toString('hex');
  const createdAt = new Date();
  const document: UserDocument = {
    _id: normalizedEmail,
    name: name.trim(),
    passwordHash,
    passwordSalt,
    createdAt,
    trialStartedAt: createdAt,
    trialEndsAt: new Date(createdAt.getTime() + TRIAL_DURATION_MS),
    paidAt: null,
    paidAmountCrc: null,
    paidMethod: null,
    activatedBy: null,
    updatedAt: createdAt,
  };

  try {
    const collection = await getUsersCollection();
    await collection.insertOne(document);
    return toRegisteredUser(document);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new UserAlreadyExistsError();
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<RegisteredUser | null> {
  const collection = await getUsersCollection();
  const document = await collection.findOne({ _id: normalizeEmail(email) });
  const hasValidHash = Boolean(document && /^[a-f\d]{128}$/i.test(document.passwordHash));
  const expected = hasValidHash ? Buffer.from(document!.passwordHash, 'hex') : Buffer.alloc(SCRYPT_KEY_LENGTH);
  const received = await derivePasswordHash(password, document?.passwordSalt ?? DUMMY_SALT);
  const matches = timingSafeEqual(expected, received);
  return document && hasValidHash && matches ? toRegisteredUser(document) : null;
}

export async function listUsers(): Promise<RegisteredUser[]> {
  const collection = await getUsersCollection();
  const documents = await collection.find({}, {
    projection: { passwordHash: 0, passwordSalt: 0 },
  }).sort({ createdAt: -1 }).toArray();
  return documents.map(toRegisteredUser);
}

export async function activateUserPayment(email: string, activatedBy: string): Promise<RegisteredUser | null> {
  const collection = await getUsersCollection();
  const paidAt = new Date();
  await collection.updateOne(
    { _id: normalizeEmail(email), paidAt: null },
    {
      $set: {
        paidAt,
        paidAmountCrc: PAID_AMOUNT_CRC,
        paidMethod: PAID_METHOD,
        activatedBy: normalizeEmail(activatedBy),
        updatedAt: paidAt,
      },
    },
  );
  return lookupUser(email);
}
