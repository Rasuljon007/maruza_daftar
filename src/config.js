import 'dotenv/config';
import path from 'node:path';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name, fallback = '') {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw.trim();
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  // APP_URL may be filled at runtime by scripts/start.js once the tunnel is up.
  appUrl: str('APP_URL').replace(/\/+$/, ''),
  sessionSecret: str('SESSION_SECRET'),
  databaseUrl: str('DATABASE_URL'),
  storageDir: path.resolve(str('STORAGE_DIR', './data')),

  transcribe: {
    provider: str('TRANSCRIBE_PROVIDER', 'groq'),
    model: str('TRANSCRIBE_MODEL', 'whisper-large-v3-turbo'),
    chunkSeconds: int('TRANSCRIBE_CHUNK_SECONDS', 600),
  },
  ai: {
    provider: str('AI_PROVIDER', 'gemini'),
    model: str('AI_MODEL', 'gemini-3.8-flash'),
  },
  keys: {
    groq: str('GROQ_API_KEY'),
    gemini: str('GEMINI_API_KEY'),
    openai: str('OPENAI_API_KEY'),
    anthropic: str('ANTHROPIC_API_KEY'),
  },
  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    username: str('TELEGRAM_BOT_USERNAME').replace(/^@/, ''),
    // Set to "false" to run the web app without the bot (e.g. in tests).
    enabled: str('TELEGRAM_BOT_ENABLED', 'true') !== 'false',
  },
  limits: {
    maxUploadMb: int('MAX_UPLOAD_MB', 300),
    aiPerHour: int('RATE_LIMIT_PER_HOUR', 60),
  },
  cloudflaredPath: str('CLOUDFLARED_PATH', 'cloudflared'),
};

const REQUIRED = [
  ['SESSION_SECRET', () => config.sessionSecret, 'node -p "require(\'crypto\').randomBytes(32).toString(\'hex\')" buyrug\'i bilan yarating.'],
  ['DATABASE_URL', () => config.databaseUrl, "Neon dashboard → Connect bo'limidan nusxalang."],
];

/** Throws a clear Uzbek error if a required variable is missing. */
export function assertConfig() {
  const missing = REQUIRED.filter(([, get]) => !get());
  if (missing.length) {
    const lines = missing.map(([name, , hint]) => `  • ${name} bo'sh. ${hint}`);
    throw new Error(`.env faylida quyidagilar yetishmayapti:\n${lines.join('\n')}`);
  }
  if (config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET juda qisqa (kamida 32 belgi kerak). Yangisini yarating.');
  }
}

/** Telegram bot link used for login and in messages. */
export function botLink(payload) {
  const base = `https://t.me/${config.telegram.username}`;
  return payload ? `${base}?start=${payload}` : base;
}
