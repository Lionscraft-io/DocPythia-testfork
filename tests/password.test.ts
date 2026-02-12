/**
 * Password Authentication Utilities Tests
 * Tests for bcrypt-based password hashing

 * Date: 2025-12-23
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generatePassword,
  isLegacyHash,
} from '../server/auth/password.js';
import crypto from 'crypto';

describe('Password Utilities', () => {
  describe('hashPassword', () => {
    it('should hash a password to a bcrypt format string', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      // Bcrypt hashes start with $2a$ or $2b$ and are 60 characters
      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });

    it('should produce different hashes for the same password (salted)', async () => {
      const password = 'consistentPassword';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Bcrypt uses random salt, so hashes should differ
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', async () => {
      const hash = await hashPassword('');

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });

    it('should handle special characters', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });

    it('should handle unicode characters', async () => {
      const password = '密码123';
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const password = 'correctPassword';
      const hash = await hashPassword(password);

      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'correctPassword';
      const hash = await hashPassword(password);

      expect(await verifyPassword('wrongPassword', hash)).toBe(false);
    });

    it('should return false for similar but different passwords', async () => {
      const password = 'Password123';
      const hash = await hashPassword(password);

      expect(await verifyPassword('password123', hash)).toBe(false); // Case difference
      expect(await verifyPassword('Password123 ', hash)).toBe(false); // Extra space
      expect(await verifyPassword('Password124', hash)).toBe(false); // One digit different
    });

    it('should handle empty password verification', async () => {
      const hash = await hashPassword('');

      expect(await verifyPassword('', hash)).toBe(true);
      expect(await verifyPassword('anything', hash)).toBe(false);
    });
  });

  describe('Legacy SHA256 Hash Support', () => {
    it('should identify legacy SHA256 hash', () => {
      // SHA256 produces 64-character hex string
      const legacyHash = 'a'.repeat(64);
      expect(isLegacyHash(legacyHash)).toBe(true);
    });

    it('should identify bcrypt hash as non-legacy', async () => {
      const bcryptHash = await hashPassword('test');
      expect(isLegacyHash(bcryptHash)).toBe(false);
    });

    it('should verify password against legacy SHA256 hash', async () => {
      // Create a real SHA256 hash of "testPassword"
      const password = 'testPassword';
      const legacyHash = crypto.createHash('sha256').update(password).digest('hex');

      expect(await verifyPassword(password, legacyHash)).toBe(true);
      expect(await verifyPassword('wrongPassword', legacyHash)).toBe(false);
    });
  });

  describe('generatePassword', () => {
    it('should generate password of default length (24)', () => {
      const password = generatePassword();

      expect(password.length).toBe(24);
    });

    it('should generate password of specified length', () => {
      expect(generatePassword(12).length).toBe(12);
      expect(generatePassword(32).length).toBe(32);
      expect(generatePassword(48).length).toBe(48);
    });

    it('should generate base64-safe characters', () => {
      const password = generatePassword(100);

      // Base64 characters are alphanumeric plus + and /
      expect(password).toMatch(/^[A-Za-z0-9+/]+$/);
    });

    it('should generate unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 100; i++) {
        passwords.add(generatePassword());
      }

      // All 100 passwords should be unique
      expect(passwords.size).toBe(100);
    });

    it('should handle minimum length', () => {
      const password = generatePassword(1);

      expect(password.length).toBe(1);
    });
  });
});
