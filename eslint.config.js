import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Catch temporal dead zone errors - using variables before they're defined
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false, // Functions are hoisted, so this is ok
          classes: true,
          variables: true,
          allowNamedExports: false,
        },
      ],
      // Disable base rule in favor of TypeScript version
      'no-use-before-define': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '*.config.js', '*.config.ts', 'prisma/'],
  }
);
