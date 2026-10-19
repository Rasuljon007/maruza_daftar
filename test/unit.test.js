import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeAnalysis, buildAnalysisPrompt, analysisSchema } from '../src/ai/prompts/analysis.js';
import { formatTime, withRetry } from '../src/util/time.js';
import { runFfmpeg, compressForSpeech, splitAudio, probeDuration } from '../src/media/ffmpeg.js';
import { buildPptx } from '../src/media/pptx.js';

test('formatTime', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(75.4), '01:15');
  assert.equal(formatTime(3725), '1:02:05');
});

test('withRetry retries transient errors and stops on 401', async () => {
  let n = 0;
  const v = await withRetry(async () => {
    if (++n < 3) throw Object.assign(new Error('boom'), { status: 500 });
    return 'ok';
  }, { baseMs: 1 });
  assert.equal(v, 'ok');
  assert.equal(n, 3);

  let m = 0;
  await assert.rejects(withRetry(async () => {
    m++;
    throw Object.assign(new Error('bad key'), { status: 401 });
  }, { baseMs: 1 }));
  assert.equal(m, 1);
});

test('normalizeAnalysis fills gaps and clamps slides', () => {
  const a = normalizeAnalysis({ title: 'X', presentation: { slides: Array.from({ length: 30 }, () => ({ title: 't' })) } }, 8);
  assert.equal(a.presentation.slides.length, 8);
  assert.deepEqual(a.presentation.slides[0].bullets, []);
  assert.equal(a.assignment.found, false);
  assert.deepEqual(a.study_materials.further_reading, []);
  assert.equal(normalizeAnalysis(null, 5).title, 'Lecture');
});

test('schema requires every property (structured output)', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    } else if (s.type === 'array') walk(s.items);
  };
  walk(analysisSchema);
});

test('prompt contains timestamps, marks, photos and notes', () => {
  const p = buildAnalysisPrompt({
    segments: [{ start_sec: 65, text: 'Hello' }],
    marks: [{ t_sec: 70, note: '' }],
    photos: [{ t_sec: 80 }],
    studentNotes: 'Essay due Friday',
    slideCount: 7,
    title: 'Econ',
  });
  assert.match(p, /\[01:05\] Hello/);
  assert.match(p, /\[01:10\] IMPORTANT/);
  assert.match(p, /Photo 1 taken at \[01:20\]/);
  assert.match(p, /Essay due Friday/);
  assert.match(p, /slides requested: 7/);
});

test('ffmpeg: compress and split into parts with correct offsets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-'));
  const src = path.join(dir, 'in.webm');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=7', '-c:a', 'libopus', src]);
  const mp3 = await compressForSpeech(src, path.join(dir, 'audio.mp3'));
  const d = await probeDuration(mp3);
  assert.ok(Math.abs(d - 7) < 0.3, `duration ${d}`);
  const parts = await splitAudio(mp3, path.join(dir, 'parts'), 3);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.offset), [0, 3, 6]);
  assert.ok(parts[2].duration > 0.5 && parts[2].duration < 1.5);
});

test('pptx is written', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-'));
  const file = path.join(dir, 's.pptx');
  await buildPptx({ title: 'T', subtitle: 'S', slides: [{ title: 'A', bullets: ['b'], speaker_notes: 'n' }] }, file);
  const buf = await fs.readFile(file);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});
