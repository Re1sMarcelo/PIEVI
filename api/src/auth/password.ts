import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const format = /^[0-9a-f]{32}:[0-9a-f]{128}$/;
const dummyHash = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;

export function isPasswordHash(value: string): boolean {
  return format.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64) as Buffer;
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const valid = !!storedHash && isPasswordHash(storedHash);
  const [salt, expected] = (valid ? storedHash : dummyHash)!.split(':');
  const supplied = await derive(password, Buffer.from(salt, 'hex'), 64) as Buffer;
  return timingSafeEqual(Buffer.from(expected, 'hex'), supplied) && valid;
}
