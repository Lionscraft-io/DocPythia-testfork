import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.ts', 'client/src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.config.*',
        '**/*.d.ts',
        'client/src/components/ui/**', // Shadcn UI components - external
      ],
    },
    // Use projects for Vitest 4
    projects: [
      {
        extends: true,
        test: {
          name: 'backend',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/frontend/**'],
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'frontend',
          include: ['tests/frontend/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./tests/frontend/setup.ts'],
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './client/src'),
            '@shared': path.resolve(__dirname, './shared'),
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
