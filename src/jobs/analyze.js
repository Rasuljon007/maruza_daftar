import { one, many, query } from '../db/index.js';
import { analyzeLecture } from '../ai/llm/index.js';
import { normalizeAnalysis } from '../ai/prompts/analysis.js';
import { buildPptx } from '../media/pptx.js';
import { paths } from '../storage/local.js';
import { AppError, describeJobError } from '../util/errors.js';
import { withRetry } from '../util/time.js';
import { setProgress } from './transcribe.js';
import { notifyLectureReady } from '../bot/index.js';

/** transcript + marks + photos + notes -> AI analysis JSON -> slides.pptx */
export async function runAnalyze({ lectureId }) {
  const lecture = await one('SELECT * FROM lectures WHERE id = $1', [lectureId]);
  if (!lecture) return;
  try {
    await setProgress(lectureId, { status: 'analyzing', progress: 82, progress_label: 'AI konspekt va prezentatsiya tayyorlamoqda…', error_message: null, error_stage: null });

    const segments = await many('SELECT start_sec, end_sec, text FROM transcript_segments WHERE lecture_id = $1 ORDER BY idx', [lectureId]);
    if (!segments.length) throw new AppError(400, 'Transkript topilmadi. Avval transkripsiyani qayta ishga tushiring.');
    const marks = await many('SELECT t_sec, note FROM marks WHERE lecture_id = $1 ORDER BY t_sec', [lectureId]);
    const photoRows = await many('SELECT t_sec, mime, file_name FROM photos WHERE lecture_id = $1 ORDER BY t_sec', [lectureId]);
    const photos = photoRows.map((p) => ({ t_sec: p.t_sec, mime: p.mime, path: paths.photo(lectureId, p.file_name) }));

    const { data, model } = await withRetry(
      () =>
        analyzeLecture({
          segments,
          marks,
          photos,
          studentNotes: lecture.student_notes,
          slideCount: lecture.slide_count,
          title: lecture.title,
        }),
      {
        attempts: 3,
        baseMs: 5000,
        onRetry: (err, n, wait) => console.warn(`[analyze] ${lectureId}: retry ${n} in ${Math.round(wait / 1000)}s (${err.status ?? err.message})`),
      },
    );
    const analysis = normalizeAnalysis(data, lecture.slide_count);

    await setProgress(lectureId, { progress: 94, progress_label: 'Prezentatsiya (.pptx) yaratilmoqda…' });
    let hasPptx = false;
    if (analysis.presentation.slides.length) {
      await buildPptx(analysis.presentation, paths.pptx(lectureId), { subject: analysis.subject });
      hasPptx = true;
    }

    await query(
      `INSERT INTO analyses (lecture_id, model, data, has_pptx) VALUES ($1, $2, $3, $4)
       ON CONFLICT (lecture_id) DO UPDATE SET model = EXCLUDED.model, data = EXCLUDED.data, has_pptx = EXCLUDED.has_pptx, created_at = now()`,
      [lectureId, model, analysis, hasPptx],
    );
    const keepTitle = lecture.title && lecture.title !== "Nomsiz ma'ruza";
    await query(
      `UPDATE lectures SET status = 'ready', progress = 100, progress_label = NULL, subject = $2,
         title = CASE WHEN $3 THEN title ELSE $4 END, updated_at = now() WHERE id = $1`,
      [lectureId, analysis.subject || null, keepTitle, analysis.title],
    );
    await notifyLectureReady(lectureId).catch((err) => console.warn('[bot] notify failed:', err.message));
  } catch (err) {
    console.error(`[analyze] ${lectureId}:`, err);
    await setProgress(lectureId, { status: 'failed', error_stage: 'analyze', error_message: describeJobError(err, 'analyze'), progress_label: null });
  }
}
