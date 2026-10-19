import fs from 'node:fs/promises';
import { config } from '../config.js';
import { pool, one, query } from '../db/index.js';
import { compressForSpeech, probeDuration, splitAudio } from '../media/ffmpeg.js';
import { paths } from '../storage/local.js';
import { transcribePart } from '../ai/transcribe/index.js';
import { AppError, describeJobError } from '../util/errors.js';
import { withRetry } from '../util/time.js';
import { enqueue, QUEUES } from './queue.js';

export async function setProgress(lectureId, fields) {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await query(`UPDATE lectures SET ${sets}, updated_at = now() WHERE id = $1`, [lectureId, ...cols.map((c) => fields[c])]);
}

/** original upload/recording -> audio.mp3 -> 10-minute parts -> Whisper -> transcript_segments. */
export async function runTranscribe({ lectureId }) {
  const lecture = await one('SELECT * FROM lectures WHERE id = $1', [lectureId]);
  if (!lecture) return; // deleted meanwhile
  try {
    await setProgress(lectureId, { status: 'transcribing', progress: 2, progress_label: 'Audio siqilmoqda…', error_message: null, error_stage: null });

    const audio = paths.audio(lectureId);
    await compressForSpeech(paths.original(lectureId, lecture.original_ext), audio);
    const duration = await probeDuration(audio);
    if (!duration || duration < 1) {
      throw new AppError(400, "Audio bo'sh yoki ovoz yozilmagan. Mikrofon ruxsatini tekshiring.");
    }
    await setProgress(lectureId, { duration_sec: Math.round(duration), progress: 8 });

    const parts = await splitAudio(audio, paths.workDir(lectureId), config.transcribe.chunkSeconds);
    const segments = [];
    let prompt = lecture.title && lecture.title !== "Nomsiz ma'ruza" ? `Lecture: ${lecture.title}.` : '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      await setProgress(lectureId, { progress_label: `Matnga aylantirilmoqda: ${i + 1}/${parts.length} bo'lak` });
      const res = await withRetry(() => transcribePart(part.file, { prompt }), {
        attempts: 4,
        onRetry: (err, n, wait) =>
          console.warn(`[transcribe] ${lectureId} part ${i + 1}: retry ${n} in ${Math.round(wait / 1000)}s (${err.status ?? err.message})`),
      });
      for (const s of res.segments) {
        segments.push({ start: part.offset + s.start, end: part.offset + Math.max(s.end, s.start), text: s.text });
      }
      // The end of this part is the context for the next one, so terms stay consistent.
      prompt = res.text.slice(-600);
      await setProgress(lectureId, { progress: Math.round(8 + ((i + 1) / parts.length) * 72) });
    }

    if (!segments.length) {
      throw new AppError(400, "Audio'da nutq topilmadi. Yozuvda ovoz eshitilishini tekshiring.");
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM transcript_segments WHERE lecture_id = $1', [lectureId]);
      // One round trip for all segments: the database is far away (Neon, Frankfurt).
      await client.query(
        `INSERT INTO transcript_segments (lecture_id, idx, start_sec, end_sec, text)
         SELECT $1, t.idx, t.s, t.e, t.txt
         FROM unnest($2::int[], $3::numeric[], $4::numeric[], $5::text[]) AS t(idx, s, e, txt)`,
        [
          lectureId,
          segments.map((_, i) => i),
          segments.map((s) => s.start.toFixed(2)),
          segments.map((s) => s.end.toFixed(2)),
          segments.map((s) => s.text),
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await fs.rm(paths.workDir(lectureId), { recursive: true, force: true });
    await setProgress(lectureId, { status: 'analyzing', progress: 80, progress_label: 'AI tahlil navbatda…' });
    await enqueue(QUEUES.analyze, { lectureId });
  } catch (err) {
    console.error(`[transcribe] ${lectureId}:`, err);
    await setProgress(lectureId, { status: 'failed', error_stage: 'transcribe', error_message: describeJobError(err, 'transcribe'), progress_label: null });
  }
}
