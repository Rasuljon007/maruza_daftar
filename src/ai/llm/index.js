import fs from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { AppError } from '../../util/errors.js';
import { SYSTEM_PROMPT, analysisSchema, buildAnalysisPrompt } from '../prompts/analysis.js';

// At most this many photos go to the model (oldest first); keeps requests small for the free tier.
export const MAX_PHOTOS = 16;

/**
 * Runs the lecture analysis on the configured provider.
 * @param {{ segments, marks, photos: {t_sec, mime, path}[], studentNotes, slideCount, title }} input
 * @returns {Promise<{ data: object, model: string }>}
 */
export async function analyzeLecture(input) {
  const photos = input.photos.slice(0, MAX_PHOTOS);
  const text = buildAnalysisPrompt({ ...input, photos });
  const images = await Promise.all(
    photos.map(async (p) => ({ mime: p.mime, base64: (await fs.readFile(p.path)).toString('base64') })),
  );
  switch (config.ai.provider) {
    case 'gemini':
      return { data: await gemini(text, images), model: config.ai.model };
    case 'anthropic':
      return { data: await anthropic(text, images), model: config.ai.model };
    case 'fake':
      return { data: fakeAnalysis(input), model: 'fake' };
    default:
      throw new AppError(500, `Noma'lum AI_PROVIDER: ${config.ai.provider}`);
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Some models wrap JSON in a code fence despite JSON mode.
    const m = String(raw ?? '').match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new AppError(502, "AI javobi to'liq kelmadi (JSON buzilgan). Qayta urinib ko'ring.");
  }
}

let geminiClient;
async function gemini(text, images) {
  if (!config.keys.gemini) throw new AppError(500, ".env da GEMINI_API_KEY bo'sh.");
  geminiClient ??= new GoogleGenAI({ apiKey: config.keys.gemini });
  const res = await geminiClient.models.generateContent({
    model: config.ai.model,
    contents: [
      {
        role: 'user',
        parts: [{ text }, ...images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.base64 } }))],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: analysisSchema,
      maxOutputTokens: 32768,
    },
  });
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') {
    throw new AppError(422, "Gemini bu ma'ruzani tahlil qilishdan bosh tortdi. Izohni o'zgartirib qayta urinib ko'ring.");
  }
  if (finish === 'MAX_TOKENS') {
    throw new AppError(502, "AI javobi juda uzun bo'lib kesilib qoldi. Slaydlar sonini kamaytirib qayta urinib ko'ring.");
  }
  return parseJson(res.text);
}

let anthropicClient;
async function anthropic(text, images) {
  if (!config.keys.anthropic) throw new AppError(500, ".env da ANTHROPIC_API_KEY bo'sh.");
  anthropicClient ??= new Anthropic({ apiKey: config.keys.anthropic, maxRetries: 2 });
  const message = await anthropicClient.messages
    .stream({
      model: config.ai.model,
      max_tokens: 64000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: analysisSchema } },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
            { type: 'text', text },
          ],
        },
      ],
    })
    .finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new AppError(422, "Claude bu ma'ruzani tahlil qilishdan bosh tortdi.");
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AppError(502, "AI javobi juda uzun bo'lib kesilib qoldi. Slaydlar sonini kamaytiring.");
  }
  const block = message.content.find((b) => b.type === 'text');
  return parseJson(block?.text);
}

/** Deterministic result for tests and offline UI work. */
function fakeAnalysis({ segments, slideCount, title }) {
  const first = segments[0]?.text ?? '';
  return {
    title: title || 'Test lecture',
    subject: 'Testing',
    summary_en: `## Overview\n- ${first}`,
    summary_uz: `## Umumiy\n- Test konspekt.`,
    key_concepts: [{ concept: 'Testing', explanation_en: 'Checking that things work.', explanation_uz: 'Ishlashini tekshirish.' }],
    glossary: [{ en: 'assignment', uz: 'vazifa', note_uz: '' }],
    key_moments: segments.slice(0, 3).map((s) => ({ t_sec: Number(s.start_sec) || 0, label_uz: 'Muhim joy' })),
    assignment: {
      found: true,
      professor_said: 'Write a two-page essay.',
      what_to_do_uz: "Ikki betlik insho yozish.",
      deadline: 'Next Friday',
      deliverables_uz: ['Insho (2 bet)'],
      preparation_steps_uz: ["Mavzuni o'qish", 'Reja tuzish'],
      seminar_preparation_uz: '',
    },
    presentation: {
      title: title || 'Test lecture',
      subtitle: 'Seminar',
      slides: Array.from({ length: slideCount }, (_, i) => ({
        title: `Slide ${i + 1}`,
        bullets: ['Point one', 'Point two', 'Point three'],
        speaker_notes: 'Explain the points.',
      })),
    },
    study_materials: {
      qa: [{ question_en: 'What is testing?', answer_en: 'Checking.', answer_uz: 'Tekshirish.' }],
      examples: [{ title: 'Example', content_en: 'An example.' }],
      further_reading: [],
    },
  };
}
