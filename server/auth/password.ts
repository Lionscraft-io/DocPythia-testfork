/**
 * Password Authentication Utilities
 * Secure bcrypt-based password hashing for admin authentication
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';

// Cost factor for bcrypt (10-12 recommended for production)
const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 * @param password - The plaintext password to hash
 * @returns Promise resolving to the hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 * @param password - The plaintext password to verify
 * @param hash - The bcrypt hash to compare against
 * @returns Promise resolving to true if password matches
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Support legacy SHA256 hashes during migration period
  if (hash.length === 64 && /^[a-f0-9]+$/.test(hash)) {
    const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
    return sha256Hash === hash;
  }

  return bcrypt.compare(password, hash);
}

/**
 * Generate a secure random password
 * @param length - Length of the password (default: 24)
 * @returns A cryptographically secure random password
 */
export function generatePassword(length: number = 24): string {
  return crypto
    .randomBytes(Math.ceil((length * 3) / 4))
    .toString('base64')
    .slice(0, length);
}

/**
 * Check if a hash is using the legacy SHA256 format
 * @param hash - The hash to check
 * @returns true if hash is legacy SHA256 format
 */
export function isLegacyHash(hash: string): boolean {
  return hash.length === 64 && /^[a-f0-9]+$/.test(hash);
}
