/**
 * Vitest Test Setup
 * Global test configuration and utilities
 */

import { vi } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env' });

// Mock environment variables for testing
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-api-key';
process.env.LLM_CLASSIFICATION_MODEL = 'gemini-2.5-flash';
process.env.LLM_PROPOSAL_MODEL = 'gemini-2.5-flash';
process.env.BATCH_WINDOW_HOURS = '24';
process.env.CONTEXT_WINDOW_HOURS = '24';
process.env.MAX_BATCH_SIZE = '500';
process.env.MIN_CONFIDENCE = '0.7';

// Global test utilities
global.mockDate = (date: string | Date) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(date));
};

global.restoreDate = () => {
  vi.useRealTimers();
};

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
