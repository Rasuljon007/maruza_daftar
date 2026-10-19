// Checks every key in .env with a tiny real request. Never prints the keys themselves.
// Usage: npm run check-keys
import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config.js';
import { pool } from '../src/db/index.js';
import { ffmpegPath, runFfmpeg } from '../src/media/ffmpeg.js';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ ok: false, name });
    const status = err?.status ? ` (HTTP ${err.status})` : '';
    console.log(`❌ ${name}${status} — ${err.message?.split('\n')[0]}`);
  }
}

function need(value, varName) {
  if (!value) throw new Error(`.env da ${varName} bo'sh`);
}

await check('SESSION_SECRET', async () => {
  need(config.sessionSecret, 'SESSION_SECRET');
  if (config.sessionSecret.length < 32) throw new Error('juda qisqa, kamida 32 belgi kerak');
  return `${config.sessionSecret.length} belgi`;
});

await check("Ma'lumotlar bazasi (Neon)", async () => {
  need(config.databaseUrl, 'DATABASE_URL');
  const { rows } = await pool.query("SELECT current_setting('server_version') AS v");
  return `PostgreSQL ${rows[0].v}`;
});

await check('Fayllar papkasi (STORAGE_DIR)', async () => {
  await fs.mkdir(config.storageDir, { recursive: true });
  const probe = path.join(config.storageDir, '.write-test');
  await fs.writeFile(probe, 'ok');
  await fs.rm(probe);
  return config.storageDir;
});

await check('ffmpeg', async () => {
  if (!ffmpegPath) throw new Error('topilmadi, `npm install` ni qayta ishga tushiring');
  await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-t', '0.1', '-f', 'null', '-']);
  return 'ishlayapti';
});

await check(`Transkripsiya (${config.transcribe.provider}, ${config.transcribe.model})`, async () => {
  if (config.transcribe.provider === 'fake') return 'soxta rejim';
  const isGroq = config.transcribe.provider === 'groq';
  const key = isGroq ? config.keys.groq : config.keys.openai;
  need(key, isGroq ? 'GROQ_API_KEY' : 'OPENAI_API_KEY');
  const client = new OpenAI({ apiKey: key, baseURL: isGroq ? 'https://api.groq.com/openai/v1' : undefined, maxRetries: 0 });
  const model = await client.models.retrieve(config.transcribe.model);
  return `kalit ishlayapti, model "${model.id}" mavjud`;
});

await check(`AI tahlil (${config.ai.provider}, ${config.ai.model})`, async () => {
  if (config.ai.provider === 'fake') return 'soxta rejim';
  if (config.ai.provider === 'gemini') {
    need(config.keys.gemini, 'GEMINI_API_KEY');
    const ai = new GoogleGenAI({ apiKey: config.keys.gemini });
    const res = await ai.models.generateContent({
      model: config.ai.model,
      contents: 'Reply with exactly: OK',
      config: { maxOutputTokens: 256 },
    });
    return `kalit ishlayapti, javob: "${(res.text ?? '').trim().slice(0, 20)}"`;
  }
  if (config.ai.provider === 'anthropic') {
    need(config.keys.anthropic, 'ANTHROPIC_API_KEY');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.keys.anthropic });
    const m = await client.models.retrieve(config.ai.model);
    return `kalit ishlayapti, model "${m.id}" mavjud`;
  }
  throw new Error(`noma'lum AI_PROVIDER: ${config.ai.provider}`);
});

await check('Telegram bot', async () => {
  need(config.telegram.token, 'TELEGRAM_BOT_TOKEN');
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/getMe`);
  const body = await res.json();
  if (!body.ok) throw Object.assign(new Error(body.description || 'token noto\'g\'ri'), { status: res.status });
  const actual = body.result.username;
  if (config.telegram.username && config.telegram.username.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`TELEGRAM_BOT_USERNAME "${config.telegram.username}", lekin token @${actual} botiga tegishli`);
  }
  return `@${actual}`;
});

await pool.end().catch(() => {});
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} ta muammo bor. Yuqoridagi ❌ qatorlarni tuzating.` : '\nHammasi tayyor! Endi: npm start');
process.exit(failed ? 1 : 0);
