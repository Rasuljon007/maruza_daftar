import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config, assertConfig } from './config.js';
import { pool } from './db/index.js';
import { migrate } from './db/migrate.js';
import { ensureDir } from './storage/local.js';
import { sessionMiddleware, requireAuth, authRouter } from './auth/index.js';
import { lecturesRouter } from './routes/lectures.js';
import { apiLimiter, loginLimiter } from './util/rateLimit.js';
import { AppError } from './util/errors.js';
import { startQueue, stopQueue, work, QUEUES } from './jobs/queue.js';
import { runTranscribe } from './jobs/transcribe.js';
import { runAnalyze } from './jobs/analyze.js';
import { startBot, stopBot } from './bot/index.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind cloudflared
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'blob:', 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Allow the page to use the microphone, camera and wake lock.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), screen-wake-lock=(self)');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use(sessionMiddleware());
  app.use('/api', apiLimiter);
  app.use('/api/auth', loginLimiter, authRouter);
  app.use('/api/lectures', requireAuth, lecturesRouter);
  app.use('/api', (_req, _res, next) => next(new AppError(404, "Bunday API yo'q.")));

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: config.env === 'production' ? '1h' : 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: "Yuborilgan bo'lak juda katta. Sahifani yangilab qayta urinib ko'ring." });
    }
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...err.extra });
    // Client-side HTTP errors from Express/send (e.g. 416 when a player asks past the end of the audio).
    const status = err?.status ?? err?.statusCode;
    if (status >= 400 && status < 500) {
      if (res.headersSent) return res.end();
      return res.status(status).json({ error: `So'rov bajarilmadi (${status}).` });
    }
    console.error(`[http] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: "Serverda kutilmagan xato yuz berdi. Bir oz kutib qayta urinib ko'ring." });
  });
  return app;
}

/** Starts DB migrations, the job queue, the bot and the HTTP server. */
export async function startServer({ port = config.port, withBot = true } = {}) {
  assertConfig();
  await ensureDir(config.storageDir);
  await migrate();
  await startQueue();
  await work(QUEUES.transcribe, runTranscribe);
  await work(QUEUES.analyze, runAnalyze);
  if (withBot) {
    await startBot().catch((err) => {
      console.error(`[bot] Bot ishga tushmadi: ${err.message}. TELEGRAM_BOT_TOKEN ni tekshiring.`);
    });
  }
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  // Large uploads over a slow mobile connection need time.
  server.requestTimeout = 10 * 60_000;
  console.log(`[http] Server http://localhost:${server.address().port} da ishlayapti`);

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log('[app] To\'xtatilmoqda…');
    await new Promise((r) => server.close(r));
    await stopBot().catch(() => {});
    await stopQueue().catch(() => {});
    await pool.end().catch(() => {});
  }
  return { server, shutdown };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then(({ shutdown }) => {
      const stop = () => shutdown().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      console.error(`\n❌ Server ishga tushmadi:\n${err.message}\n`);
      process.exit(1);
    });
}
