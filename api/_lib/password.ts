import { scrypt, timingSafeEqual } from 'node:crypto';

/** Preserve the legacy derivation, including Node's existing hex decoding. */
export async function verifyAccountPassword(password: string, salt: string, hash: string) {
  const expected = Buffer.from(hash, 'hex');
  const received = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, expected.length, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return timingSafeEqual(expected, received);
}
