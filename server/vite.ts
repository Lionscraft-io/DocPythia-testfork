import express, { type Express } from 'express';
import fs from 'fs';
import path from 'path';
import { type Server } from 'http';

// These imports are only available in development
let createViteServer: any;
let createLogger: any;
let nanoid: any;

// Dynamically import development dependencies
async function loadDevDependencies() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await import('vite');
    const nanoidModule = await import('nanoid');
    createViteServer = vite.createServer;
    createLogger = vite.createLogger;
    nanoid = nanoidModule.nanoid;
  }
}

let viteLogger: any;

export function log(message: string, source = 'express') {
  const formattedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // This function should only be called in development
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setupVite should not be called in production');
  }

  // Load development dependencies
  await loadDevDependencies();
  viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  // Create vite server with config file discovery
  const vite = await createViteServer({
    configFile: 'vite.config.ts',
    customLogger: {
      ...viteLogger,
      error: (msg: string, options?: any) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: 'custom',
  });

  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(process.cwd(), 'client', 'index.html');

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, 'utf-8');
      template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), 'dist', 'public');

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
