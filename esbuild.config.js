import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outdir: 'dist',
  packages: 'external',
  // Explicitly mark dotenv as external to avoid dynamic require issues in ESM
  external: ['dotenv'],
  alias: {
    '@shared': path.resolve(__dirname, 'shared'),
  },
  // Resolve .ts files
  resolveExtensions: ['.ts', '.js'],
  // Handle TypeScript
  loader: {
    '.ts': 'ts',
  },
};

try {
  await build(config);
  console.log('✅ Server build completed successfully');
} catch (error) {
  console.error('❌ Server build failed:', error);
  process.exit(1);
}
