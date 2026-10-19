import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import express, { Router } from 'express';
import { config } from '../config.js';
import { one, many, query } from '../db/index.js';
import { paths, ensureDir, writeFileAtomic, concatChunks, removeLecture, exists } from '../storage/local.js';
import { AppError, errors, wrap } from '../util/errors.js';
import { formatTime } from '../util/time.js';
import { enqueue, QUEUES } from '../jobs/queue.js';
import { aiLimiter } from '../util/rateLimit.js';

export const lecturesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK_LIMIT = '12mb';
const AUDIO_EXTS = new Set(['webm', 'ogg', 'oga', 'opus', 'mp3', 'm4a', 'mp4', 'aac', 'wav', 'flac', 'mov', 'mkv', 'mpeg', 'mpga', '3gp', 'amr']);
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const BUSY = new Set(['queued', 'transcribing', 'analyzing']);

/** Loads a lecture owned by the logged-in user, or 404. */
async function ownLecture(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) throw errors.notFound();
  const lecture = await one('SELECT * FROM lectures WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
  if (!lecture) throw errors.notFound();
  return lecture;
}

function publicLecture(l) {
  return {
    id: l.id,
    title: l.title,
    subject: l.subject,
    source: l.source,
    status: l.status,
    progress: l.progress,
    progressLabel: l.progress_label,
    errorMessage: l.error_message,
    errorStage: l.error_stage,
    durationSec: l.duration_sec,
    studentNotes: l.student_notes,
    slideCount: l.slide_count,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

function cleanTitle(raw) {
  const t = String(raw ?? '').trim().slice(0, 200);
  return t || "Nomsiz ma'ruza";
}

function cleanSlideCount(raw, fallback = 10) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(5, n));
}

lecturesRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = await many('SELECT * FROM lectures WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [req.session.userId]);
    res.json({ lectures: rows.map(publicLecture) });
  }),
);

lecturesRouter.post(
  '/',
  express.json(),
  wrap(async (req, res) => {
    const source = req.body?.source === 'upload' ? 'upload' : 'recording';
    // The browser may pick the id itself, so a recording can start before it reaches the server.
    const id = UUID_RE.test(req.body?.id ?? '') ? req.body.id.toLowerCase() : crypto.randomUUID();
    let lecture = await one(
      `INSERT INTO lectures (id, user_id, title, source, slide_count, student_notes) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, req.session.userId, cleanTitle(req.body?.title), source, cleanSlideCount(req.body?.slideCount), String(req.body?.studentNotes ?? '').slice(0, 5000)],
    );
    if (!lecture) {
      lecture = await one('SELECT * FROM lectures WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
      if (!lecture) throw errors.badRequest("Bu identifikator band. Sahifani yangilab qayta urinib ko'ring.");
    }
    await ensureDir(paths.chunksDir(lecture.id));
    res.status(201).json({ lecture: publicLecture(lecture) });
  }),
);

lecturesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const [marks, photos, segments, analysis, chunks] = await Promise.all([
      many('SELECT id, t_sec, note FROM marks WHERE lecture_id = $1 ORDER BY t_sec', [l.id]),
      many('SELECT id, t_sec FROM photos WHERE lecture_id = $1 ORDER BY t_sec', [l.id]),
      req.query.full === '0' ? [] : many('SELECT id, idx, start_sec, end_sec, text, edited FROM transcript_segments WHERE lecture_id = $1 ORDER BY idx', [l.id]),
      req.query.full === '0' ? null : one('SELECT model, data, has_pptx, created_at FROM analyses WHERE lecture_id = $1', [l.id]),
      many('SELECT seq FROM audio_chunks WHERE lecture_id = $1 ORDER BY seq', [l.id]),
    ]);
    res.json({
      lecture: publicLecture(l),
      marks,
      photos,
      segments,
      analysis,
      receivedChunks: chunks.map((c) => c.seq),
      hasAudio: await exists(paths.audio(l.id)),
    });
  }),
);

lecturesRouter.patch(
  '/:id',
  express.json(),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const title = req.body?.title !== undefined ? cleanTitle(req.body.title) : l.title;
    const notes = req.body?.studentNotes !== undefined ? String(req.body.studentNotes).slice(0, 5000) : l.student_notes;
    const slides = req.body?.slideCount !== undefined ? cleanSlideCount(req.body.slideCount, l.slide_count) : l.slide_count;
    const row = await one(
      'UPDATE lectures SET title = $2, student_notes = $3, slide_count = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [l.id, title, notes, slides],
    );
    res.json({ lecture: publicLecture(row) });
  }),
);

lecturesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    await query('DELETE FROM lectures WHERE id = $1', [l.id]);
    await removeLecture(l.id);
    res.json({ ok: true });
  }),
);

/** Receives one piece of audio (recording slices or a file split in the browser). Idempotent per seq. */
lecturesRouter.put(
  '/:id/chunks/:seq',
  express.raw({ type: () => true, limit: CHUNK_LIMIT }),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    if (l.status !== 'recording') throw errors.badRequest("Bu ma'ruza allaqachon yakunlangan, yangi audio qabul qilinmaydi.");
    const seq = Number.parseInt(req.params.seq, 10);
    if (!Number.isInteger(seq) || seq < 0 || seq > 100_000) throw errors.badRequest("Noto'g'ri bo'lak raqami.");
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw errors.badRequest("Bo'sh audio bo'lagi keldi. Qayta yuboring.");

    const { total } = await one('SELECT COALESCE(SUM(bytes), 0)::bigint AS total FROM audio_chunks WHERE lecture_id = $1 AND seq <> $2', [l.id, seq]);
    if (Number(total) + body.length > config.limits.maxUploadMb * 1024 * 1024) throw errors.tooLarge(config.limits.maxUploadMb);

    await writeFileAtomic(paths.chunk(l.id, seq), body);
    await query(
      `INSERT INTO audio_chunks (lecture_id, seq, bytes) VALUES ($1, $2, $3)
       ON CONFLICT (lecture_id, seq) DO UPDATE SET bytes = EXCLUDED.bytes, received_at = now()`,
      [l.id, seq, body.length],
    );
    await query('UPDATE lectures SET updated_at = now() WHERE id = $1', [l.id]);
    res.json({ ok: true, seq });
  }),
);

/** All chunks are in: join them and start transcription. */
lecturesRouter.post(
  '/:id/finish',
  aiLimiter,
  express.json(),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    if (l.status !== 'recording') return res.json({ lecture: publicLecture(l) }); // already finished (retry-safe)

    const total = Number.parseInt(req.body?.totalChunks, 10);
    if (!Number.isInteger(total) || total < 1) throw errors.badRequest("Audio bo'laklari soni noto'g'ri.");
    const ext = String(req.body?.ext ?? 'webm').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!AUDIO_EXTS.has(ext)) {
      throw errors.badRequest(`".${ext}" formatini qabul qilmayman. Audio yoki video fayl tanlang (mp3, m4a, wav, webm, mp4...).`);
    }

    const have = new Set((await many('SELECT seq FROM audio_chunks WHERE lecture_id = $1', [l.id])).map((r) => r.seq));
    const missing = [];
    for (let i = 0; i < total; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) {
      throw new AppError(409, "Ba'zi audio bo'laklari hali serverga yetib kelmadi. Ular qayta yuborilmoqda.", { missing: missing.slice(0, 500) });
    }

    await concatChunks(l.id, total, paths.original(l.id, ext));
    const row = await one(
      `UPDATE lectures SET status = 'queued', progress = 1, progress_label = 'Navbatda…', original_ext = $2,
         error_message = NULL, error_stage = NULL, updated_at = now()
       WHERE id = $1 AND status = 'recording' RETURNING *`,
      [l.id, ext],
    );
    if (!row) return res.json({ lecture: publicLecture(await one('SELECT * FROM lectures WHERE id = $1', [l.id])) });
    await enqueue(QUEUES.transcribe, { lectureId: l.id });
    await fs.rm(paths.chunksDir(l.id), { recursive: true, force: true });
    await query('DELETE FROM audio_chunks WHERE lecture_id = $1', [l.id]);
    res.json({ lecture: publicLecture(row) });
  }),
);

lecturesRouter.post(
  '/:id/marks',
  express.json(),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const t = Number(req.body?.tSec);
    if (!Number.isFinite(t) || t < 0) throw errors.badRequest("Vaqt belgisi noto'g'ri.");
    const mark = await one('INSERT INTO marks (lecture_id, t_sec, note) VALUES ($1, $2, $3) RETURNING id, t_sec, note', [
      l.id, t.toFixed(1), String(req.body?.note ?? '').slice(0, 500),
    ]);
    res.status(201).json({ mark });
  }),
);

lecturesRouter.delete(
  '/:id/marks/:markId',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    await query('DELETE FROM marks WHERE id = $1 AND lecture_id = $2', [Number(req.params.markId) || 0, l.id]);
    res.json({ ok: true });
  }),
);

lecturesRouter.post(
  '/:id/photos',
  express.raw({ type: () => true, limit: '10mb' }),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[mime];
    if (!ext) throw errors.badRequest('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw errors.badRequest("Rasm bo'sh keldi.");
    const t = Number(req.query.t);
    const tSec = Number.isFinite(t) && t >= 0 ? t : 0;
    const count = await one('SELECT count(*)::int AS n FROM photos WHERE lecture_id = $1', [l.id]);
    if (count.n >= 60) throw errors.badRequest("Bitta ma'ruzaga eng ko'pi 60 ta rasm qo'shish mumkin.");
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFileAtomic(paths.photo(l.id, fileName), req.body);
    const photo = await one('INSERT INTO photos (lecture_id, t_sec, mime, file_name) VALUES ($1, $2, $3, $4) RETURNING id, t_sec', [
      l.id, tSec.toFixed(1), mime, fileName,
    ]);
    res.status(201).json({ photo });
  }),
);

lecturesRouter.get(
  '/:id/photos/:photoId',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const p = await one('SELECT mime, file_name FROM photos WHERE id = $1 AND lecture_id = $2', [Number(req.params.photoId) || 0, l.id]);
    if (!p) throw errors.notFound('Rasm');
    res.type(p.mime).sendFile(paths.photo(l.id, p.file_name), { maxAge: '7d' });
  }),
);

lecturesRouter.delete(
  '/:id/photos/:photoId',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const p = await one('DELETE FROM photos WHERE id = $1 AND lecture_id = $2 RETURNING file_name', [Number(req.params.photoId) || 0, l.id]);
    if (p) await fs.rm(paths.photo(l.id, p.file_name), { force: true });
    res.json({ ok: true });
  }),
);

/** Compressed lecture audio for the player (supports Range requests for seeking). */
lecturesRouter.get(
  '/:id/audio',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const file = paths.audio(l.id);
    if (!(await exists(file))) throw errors.notFound('Audio');
    res.type('audio/mpeg').sendFile(file, { acceptRanges: true });
  }),
);

lecturesRouter.patch(
  '/:id/segments/:segId',
  express.json(),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const text = String(req.body?.text ?? '').trim().slice(0, 5000);
    if (!text) throw errors.badRequest("Matn bo'sh bo'lishi mumkin emas.");
    const seg = await one(
      'UPDATE transcript_segments SET text = $3, edited = true WHERE id = $1 AND lecture_id = $2 RETURNING id, idx, start_sec, end_sec, text, edited',
      [Number(req.params.segId) || 0, l.id, text],
    );
    if (!seg) throw errors.notFound('Gap');
    res.json({ segment: seg });
  }),
);

/** Re-runs the AI analysis (e.g. after editing the transcript or adding notes). */
lecturesRouter.post(
  '/:id/analyze',
  aiLimiter,
  express.json(),
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    if (BUSY.has(l.status) || l.status === 'recording') throw errors.busy();
    const n = await one('SELECT count(*)::int AS n FROM transcript_segments WHERE lecture_id = $1', [l.id]);
    if (!n.n) throw errors.badRequest('Avval transkripsiya tugashi kerak.');
    const row = await one(
      `UPDATE lectures SET status = 'analyzing', progress = 80, progress_label = 'AI tahlil navbatda…',
         slide_count = $2, student_notes = $3, error_message = NULL, error_stage = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [l.id, cleanSlideCount(req.body?.slideCount, l.slide_count), req.body?.studentNotes !== undefined ? String(req.body.studentNotes).slice(0, 5000) : l.student_notes],
    );
    await enqueue(QUEUES.analyze, { lectureId: l.id });
    res.json({ lecture: publicLecture(row) });
  }),
);

/** After a failure: start again from the stage that failed. */
lecturesRouter.post(
  '/:id/retry',
  aiLimiter,
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    if (l.status !== 'failed') throw errors.badRequest("Bu ma'ruzada xato yo'q.");
    const stage = l.error_stage === 'analyze' ? 'analyze' : 'transcribe';
    if (stage === 'transcribe' && !(await exists(paths.original(l.id, l.original_ext)))) {
      throw errors.badRequest("Asl audio fayl topilmadi. Ma'ruzani qaytadan yuklashingiz kerak.");
    }
    const row = await one(
      `UPDATE lectures SET status = $2, progress = $3, progress_label = 'Navbatda…', error_message = NULL, error_stage = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [l.id, stage === 'analyze' ? 'analyzing' : 'queued', stage === 'analyze' ? 80 : 1],
    );
    await enqueue(stage === 'analyze' ? QUEUES.analyze : QUEUES.transcribe, { lectureId: l.id });
    res.json({ lecture: publicLecture(row) });
  }),
);

function safeFileName(title, ext) {
  const base = String(title || 'maruza').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().slice(0, 80) || 'maruza';
  return `${base}.${ext}`;
}

lecturesRouter.get(
  '/:id/slides.pptx',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const file = paths.pptx(l.id);
    if (!(await exists(file))) throw errors.notFound('Prezentatsiya');
    res.download(file, safeFileName(l.title, 'pptx'));
  }),
);

lecturesRouter.get(
  '/:id/transcript.txt',
  wrap(async (req, res) => {
    const l = await ownLecture(req);
    const segs = await many('SELECT start_sec, text FROM transcript_segments WHERE lecture_id = $1 ORDER BY idx', [l.id]);
    if (!segs.length) throw errors.notFound('Transkript');
    const body = `${l.title}\n\n${segs.map((s) => `[${formatTime(s.start_sec)}] ${s.text}`).join('\n')}\n`;
    res.attachment(safeFileName(l.title, 'txt')).type('text/plain; charset=utf-8').send(body);
  }),
);
