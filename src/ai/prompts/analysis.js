import { formatTime } from '../../util/time.js';

const str = { type: 'string' };
const strArr = { type: 'array', items: str };
const obj = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** JSON Schema of the analysis result (used by Gemini and Claude structured output). */
export const analysisSchema = obj({
  title: str,
  subject: str,
  summary_en: str,
  summary_uz: str,
  key_concepts: { type: 'array', items: obj({ concept: str, explanation_en: str, explanation_uz: str }) },
  glossary: { type: 'array', items: obj({ en: str, uz: str, note_uz: str }) },
  key_moments: { type: 'array', items: obj({ t_sec: { type: 'number' }, label_uz: str }) },
  assignment: obj({
    found: { type: 'boolean' },
    professor_said: str,
    what_to_do_uz: str,
    deadline: str,
    deliverables_uz: strArr,
    preparation_steps_uz: strArr,
    seminar_preparation_uz: str,
  }),
  presentation: obj({
    title: str,
    subtitle: str,
    slides: { type: 'array', items: obj({ title: str, bullets: strArr, speaker_notes: str }) },
  }),
  study_materials: obj({
    qa: { type: 'array', items: obj({ question_en: str, answer_en: str, answer_uz: str }) },
    examples: { type: 'array', items: obj({ title: str, content_en: str }) },
    further_reading: { type: 'array', items: obj({ title: str, author: str, why_uz: str }) },
  }),
});

export const SYSTEM_PROMPT = `You help a university student in Uzbekistan who attends lectures taught in English.
You receive an automatic transcript of one lecture (with timestamps), moments the student marked as important,
photos of the board/screen taken during the lecture, and optional notes from the student.

Rules:
- The transcript comes from speech recognition and contains errors. Silently correct misheard words and terms
  using context; never mention the corrections.
- Pay special attention to the marked moments, especially for assignments, deadlines and exam hints.
- Use the photos: include formulas, diagrams and tables from them in the summary and slides where relevant.
- The student's own notes about what the professor said are reliable; prefer them over the transcript.
- Fields ending in _uz are written in Uzbek (Latin script), clear and natural. Fields ending in _en, and the
  presentation, are in English.
- summary_en and summary_uz are structured Markdown study notes (headings, bullet points, formulas), thorough
  enough to replace attending the lecture.
- assignment: set found=true only if the professor actually gave a task. If found=false, leave the task fields
  as empty strings/arrays and write seminar_preparation_uz: how to prepare for the next seminar on this topic.
  If no deadline was stated, deadline is "".
- presentation: exactly the requested number of slides, ready to present at a seminar. Each slide: a short title,
  3-5 concise bullets, and speaker notes (what to say, 3-6 sentences). The first slide introduces the topic, the
  last one summarizes it. Do not include a separate title slide; it is added automatically.
- key_moments: 5-12 moments with t_sec taken from the transcript timestamps.
- further_reading: only real, well-known books or papers you are confident exist. Never invent URLs or titles.
  An empty list is better than a made-up source.`;

/** Builds the user message text. Photos are attached separately, in the same order as listed here. */
export function buildAnalysisPrompt({ segments, marks, photos, studentNotes, slideCount, title }) {
  const transcript = segments.map((s) => `[${formatTime(s.start_sec)}] ${s.text}`).join('\n');
  const markLines = marks.length
    ? marks.map((m) => `- [${formatTime(m.t_sec)}] IMPORTANT${m.note ? `: ${m.note}` : ''}`).join('\n')
    : '(none)';
  const photoLines = photos.length
    ? photos.map((p, i) => `- Photo ${i + 1} taken at [${formatTime(p.t_sec)}]`).join('\n')
    : '(none)';
  return `Lecture title given by the student: ${title || '(none)'}
Number of presentation slides requested: ${slideCount}

Moments the student marked as important:
${markLines}

Photos of the board/screen (attached in this order):
${photoLines}

Student's notes (e.g. what the professor said about the assignment):
${studentNotes?.trim() || '(none)'}

TRANSCRIPT:
${transcript}`;
}

/** Fills gaps so the UI never breaks on a partially valid model answer. */
export function normalizeAnalysis(raw, slideCount) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const asg = a.assignment ?? {};
  const pres = a.presentation ?? {};
  const sm = a.study_materials ?? {};
  return {
    title: s(a.title) || 'Lecture',
    subject: s(a.subject),
    summary_en: s(a.summary_en),
    summary_uz: s(a.summary_uz),
    key_concepts: arr(a.key_concepts).map((c) => ({ concept: s(c.concept), explanation_en: s(c.explanation_en), explanation_uz: s(c.explanation_uz) })),
    glossary: arr(a.glossary).map((g) => ({ en: s(g.en), uz: s(g.uz), note_uz: s(g.note_uz) })),
    key_moments: arr(a.key_moments).map((k) => ({ t_sec: Number(k.t_sec) || 0, label_uz: s(k.label_uz) })),
    assignment: {
      found: Boolean(asg.found),
      professor_said: s(asg.professor_said),
      what_to_do_uz: s(asg.what_to_do_uz),
      deadline: s(asg.deadline),
      deliverables_uz: arr(asg.deliverables_uz).map(s),
      preparation_steps_uz: arr(asg.preparation_steps_uz).map(s),
      seminar_preparation_uz: s(asg.seminar_preparation_uz),
    },
    presentation: {
      title: s(pres.title) || s(a.title) || 'Lecture',
      subtitle: s(pres.subtitle),
      slides: arr(pres.slides)
        .slice(0, Math.max(5, Math.min(20, slideCount || 20)))
        .map((sl) => ({ title: s(sl.title), bullets: arr(sl.bullets).map(s), speaker_notes: s(sl.speaker_notes) })),
    },
    study_materials: {
      qa: arr(sm.qa).map((q) => ({ question_en: s(q.question_en), answer_en: s(q.answer_en), answer_uz: s(q.answer_uz) })),
      examples: arr(sm.examples).map((e) => ({ title: s(e.title), content_en: s(e.content_en) })),
      further_reading: arr(sm.further_reading).map((r) => ({ title: s(r.title), author: s(r.author), why_uz: s(r.why_uz) })),
    },
  };
}
