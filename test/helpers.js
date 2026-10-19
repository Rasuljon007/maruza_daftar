// Test setup: real PostgreSQL (TEST_DATABASE_URL), fake AI providers, no Telegram.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TEST_DB = process.env.TEST_DATABASE_URL;

export async function setupEnv() {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'maruza-test-'));
  Object.assign(process.env, {
    DATABASE_URL: TEST_DB,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
    STORAGE_DIR: storage,
    TRANSCRIBE_PROVIDER: 'fake',
    AI_PROVIDER: 'fake',
    TELEGRAM_BOT_ENABLED: 'false',
    TELEGRAM_BOT_USERNAME: 'test_bot',
    TRANSCRIBE_CHUNK_SECONDS: '2',
  });
  return storage;
}

/** Minimal cookie-keeping HTTP client. */
export function client(base) {
  let cookie = '';
  return async function call(pathname, { method = 'GET', json, body, headers = {} } = {}) {
    const res = await fetch(base + pathname, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
}
