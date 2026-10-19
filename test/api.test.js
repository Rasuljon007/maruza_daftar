// End-to-end API test: login -> upload audio in pieces -> transcription -> analysis -> pptx.
// Needs a throwaway PostgreSQL database: TEST_DATABASE_URL=postgres://... npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TEST_DB, setupEnv, client } from './helpers.js';

const skip = !TEST_DB && 'TEST_DATABASE_URL is not set';
let srv;
let base;
let db;

before(async () => {
  if (skip) return;
  await setupEnv();
  const pg = (await import('pg')).default;
  const reset = new pg.Client({ connectionString: TEST_DB });
  await reset.connect();
  await reset.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS pgboss CASCADE;');
  await reset.end();
  const { startServer } = await import('../src/server.js');
  srv = await startServer({ port: 0, withBot: false });
  base = `http://127.0.0.1:${srv.server.address().port}`;
  db = (await import('../src/db/index.js')).pool;
});

after(async () => {
  await srv?.shutdown();
});

/** Logs in the way the bot would: confirm the token in the DB. */
async function login(call, telegramId) {
  const start = await call('/api/auth/start', { method: 'POST' });
  assert.equal(start.status, 200);
  const token = start.data.botUrl.split('login_')[1];
  const { rows } = await db.query(
    'INSERT INTO users (telegram_id, first_name) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name RETURNING id',
    [telegramId, 'Test'],
  );
  await db.query('UPDATE login_tokens SET user_id = $2, confirmed_at = now() WHERE token = $1', [token, rows[0].id]);
  const poll = await call('/api/auth/poll');
  assert.equal(poll.data.loggedIn, true);
}

async function makeAudio(seconds) {
  const { runFfmpeg } = await import('../src/media/ffmpeg.js');
  const dir = await fs.mkdtemp(path.join(process.env.STORAGE_DIR, 'src-'));
  const file = path.join(dir, 'tone.webm');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libopus', '-b:a', '32k', file]);
  return fs.readFile(file);
}

async function waitFor(call, id, statuses, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await call(`/api/lectures/${id}`);
    if (statuses.includes(r.data.lecture.status)) return r.data;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout, status=${r.data.lecture.status} ${r.data.lecture.errorMessage ?? ''}`);
    await new Promise((res) => setTimeout(res, 500));
  }
}

test('API requires login', { skip }, async () => {
  const call = client(base);
  const r = await call('/api/lectures');
  assert.equal(r.status, 401);
  assert.match(r.data.error, /Telegram/);
});

test('full pipeline: chunks -> transcript -> analysis -> pptx', { skip }, async () => {
  const call = client(base);
  await login(call, 1001);

  const created = await call('/api/lectures', { method: 'POST', json: { title: 'Economics 101', slideCount: 6 } });
  assert.equal(created.status, 201);
  const id = created.data.lecture.id;

  // Two pieces of one webm stream, uploaded out of order, one twice (idempotent).
  const audio = await makeAudio(5);
  const half = Math.floor(audio.length / 2);
  const put = (seq, buf) => call(`/api/lectures/${id}/chunks/${seq}`, { method: 'PUT', body: buf, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal((await put(1, audio.subarray(half))).status, 200);
  assert.equal((await put(0, audio.subarray(0, half))).status, 200);
  assert.equal((await put(0, audio.subarray(0, half))).status, 200);

  // A missing piece is reported, not silently ignored.
  const missing = await call(`/api/lectures/${id}/finish`, { method: 'POST', json: { totalChunks: 3, ext: 'webm' } });
  assert.equal(missing.status, 409);
  assert.deepEqual(missing.data.missing, [2]);

  const mark = await call(`/api/lectures/${id}/marks`, { method: 'POST', json: { tSec: 3.2 } });
  assert.equal(mark.status, 201);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const photo = await call(`/api/lectures/${id}/photos?t=2`, { method: 'POST', body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(photo.status, 201);

  const fin = await call(`/api/lectures/${id}/finish`, { method: 'POST', json: { totalChunks: 2, ext: 'webm' } });
  assert.equal(fin.status, 200);
  assert.equal(fin.data.lecture.status, 'queued');

  const done = await waitFor(call, id, ['ready', 'failed']);
  assert.equal(done.lecture.status, 'ready', done.lecture.errorMessage);
  assert.ok(done.lecture.durationSec >= 4 && done.lecture.durationSec <= 6, `duration ${done.lecture.durationSec}`);
  // 5 s audio split into 2 s parts -> 3 parts x 2 fake segments, offsets shifted per part.
  assert.equal(done.segments.length, 6);
  assert.equal(Number(done.segments[2].start_sec), 2);
  assert.equal(done.analysis.data.presentation.slides.length, 6);
  assert.equal(done.analysis.has_pptx, true);
  assert.equal(done.hasAudio, true);
  assert.equal(done.lecture.title, 'Economics 101');

  const pptx = await call(`/api/lectures/${id}/slides.pptx`);
  assert.equal(pptx.status, 200);
  assert.equal(pptx.data.subarray(0, 2).toString(), 'PK'); // zip container

  const txt = await call(`/api/lectures/${id}/transcript.txt`);
  assert.match(txt.data.toString(), /\[00:02\]/);

  const range = await call(`/api/lectures/${id}/audio`, { headers: { range: 'bytes=0-99' } });
  assert.equal(range.status, 206);

  // Editing a sentence, then re-running the analysis.
  const seg = done.segments[0];
  const edited = await call(`/api/lectures/${id}/segments/${seg.id}`, { method: 'PATCH', json: { text: 'Corrected sentence.' } });
  assert.equal(edited.data.segment.edited, true);
  const re = await call(`/api/lectures/${id}/analyze`, { method: 'POST', json: { slideCount: 5, studentNotes: 'Essay due Friday' } });
  assert.equal(re.status, 200);
  const again = await waitFor(call, id, ['ready', 'failed']);
  assert.equal(again.analysis.data.presentation.slides.length, 5);
  assert.equal(again.lecture.studentNotes, 'Essay due Friday');

  // Another user cannot see it.
  const other = client(base);
  await login(other, 2002);
  assert.equal((await other(`/api/lectures/${id}`)).status, 404);

  assert.equal((await call(`/api/lectures/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/lectures/${id}`)).status, 404);
});

test('silent/empty audio fails with an Uzbek explanation', { skip }, async () => {
  const call = client(base);
  await login(call, 1001);
  const { data } = await call('/api/lectures', { method: 'POST', json: {} });
  const id = data.lecture.id;
  await call(`/api/lectures/${id}/chunks/0`, { method: 'PUT', body: Buffer.from('not audio at all'), headers: { 'content-type': 'application/octet-stream' } });
  await call(`/api/lectures/${id}/finish`, { method: 'POST', json: { totalChunks: 1, ext: 'webm' } });
  const done = await waitFor(call, id, ['ready', 'failed']);
  assert.equal(done.lecture.status, 'failed');
  assert.equal(done.lecture.errorStage, 'transcribe');
  assert.match(done.lecture.errorMessage, /Transkripsiya/);
});

test('rejects unknown file types and oversize chunks', { skip }, async () => {
  const call = client(base);
  await login(call, 1001);
  const { data } = await call('/api/lectures', { method: 'POST', json: { source: 'upload' } });
  const id = data.lecture.id;
  await call(`/api/lectures/${id}/chunks/0`, { method: 'PUT', body: Buffer.from('x'), headers: { 'content-type': 'application/octet-stream' } });
  const bad = await call(`/api/lectures/${id}/finish`, { method: 'POST', json: { totalChunks: 1, ext: 'exe' } });
  assert.equal(bad.status, 400);
  const big = await call(`/api/lectures/${id}/chunks/1`, { method: 'PUT', body: Buffer.alloc(13 * 1024 * 1024), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(big.status, 413);
});
