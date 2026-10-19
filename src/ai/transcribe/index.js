import fs from 'node:fs';
import OpenAI from 'openai';
import { config } from '../../config.js';
import { AppError } from '../../util/errors.js';

const PROVIDERS = {
  // Groq serves Whisper through an OpenAI-compatible API.
  groq: { baseURL: 'https://api.groq.com/openai/v1', key: () => config.keys.groq, keyName: 'GROQ_API_KEY' },
  openai: { baseURL: undefined, key: () => config.keys.openai, keyName: 'OPENAI_API_KEY' },
};

let cachedClient;

function client() {
  const p = PROVIDERS[config.transcribe.provider];
  if (!p) throw new AppError(500, `Noma'lum TRANSCRIBE_PROVIDER: ${config.transcribe.provider}`);
  if (!p.key()) throw new AppError(500, `.env da ${p.keyName} bo'sh.`);
  cachedClient ??= new OpenAI({ apiKey: p.key(), baseURL: p.baseURL, maxRetries: 0, timeout: 10 * 60_000 });
  return cachedClient;
}

/**
 * Transcribes one audio part (English).
 * @returns {Promise<{ text: string, segments: { start: number, end: number, text: string }[] }>}
 */
export async function transcribePart(file, { prompt = '' } = {}) {
  if (config.transcribe.provider === 'fake') return fakeTranscribe(file);
  const res = await client().audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: config.transcribe.model,
    language: 'en',
    response_format: 'verbose_json',
    temperature: 0,
    // Whisper only uses the last ~224 tokens of the prompt; keep it short.
    ...(prompt ? { prompt: prompt.slice(-600) } : {}),
  });
  const segments = (res.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text ?? '').trim() }))
    .filter((s) => s.text);
  if (!segments.length && res.text?.trim()) {
    segments.push({ start: 0, end: Number(res.duration) || 0, text: res.text.trim() });
  }
  return { text: res.text ?? segments.map((s) => s.text).join(' '), segments };
}

/** Offline stand-in used in tests and for trying the UI without API keys. */
function fakeTranscribe(file) {
  const name = file.split(/[\\/]/).pop();
  const segments = [
    { start: 0, end: 4, text: `Today we start a new topic (${name}).` },
    { start: 4, end: 9, text: 'Your assignment is a two-page essay, due next Friday.' },
  ];
  return { text: segments.map((s) => s.text).join(' '), segments };
}
