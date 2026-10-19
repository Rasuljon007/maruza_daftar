import PptxGenJS from 'pptxgenjs';
import { ensureDir } from '../storage/local.js';
import path from 'node:path';

// "Notebook and marker" palette: warm paper, ink, highlighter yellow, red margin line.
const C = {
  paper: 'FBF8F1',
  ink: '1F2A37',
  muted: '5B6573',
  marker: 'FFD84D',
  margin: 'E35D5D',
  rule: 'D7E3F0',
};
const FONT_HEAD = 'Georgia';
const FONT_BODY = 'Calibri';

function paperBackground(slide, { lines = true } = {}) {
  slide.background = { color: C.paper };
  // Red margin line, like a notebook page.
  slide.addShape('line', { x: 0.7, y: 0, w: 0, h: 7.5, line: { color: C.margin, width: 1.25 } });
  if (lines) {
    for (let y = 1.6; y < 7.4; y += 0.5) {
      slide.addShape('line', { x: 0.7, y, w: 12.63, h: 0, line: { color: C.rule, width: 0.5 } });
    }
  }
}

function markerTitle(slide, text, { y = 0.45, size = 30 } = {}) {
  // Highlighter stroke behind the title.
  const width = Math.min(11.8, 0.6 + text.length * size * 0.0085);
  slide.addShape('rect', { x: 0.95, y: y + 0.42, w: width, h: 0.32, fill: { color: C.marker, transparency: 25 }, line: { type: 'none' } });
  slide.addText(text, { x: 0.95, y, w: 11.9, h: 0.8, fontFace: FONT_HEAD, fontSize: size, bold: true, color: C.ink, valign: 'bottom', fit: 'shrink' });
}

/**
 * Builds a clean 16:9 deck from analysis.presentation and writes it to `file`.
 * @param {{ title: string, subtitle: string, slides: { title: string, bullets: string[], speaker_notes: string }[] }} presentation
 */
export async function buildPptx(presentation, file, { subject = '' } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = presentation.title;
  pptx.subject = subject;
  pptx.company = "Ma'ruza Daftari";

  // Title slide
  const t = pptx.addSlide();
  paperBackground(t, { lines: false });
  t.addShape('rect', { x: 0.95, y: 3.55, w: 6.2, h: 0.12, fill: { color: C.marker }, line: { type: 'none' } });
  t.addText(presentation.title, { x: 0.95, y: 1.6, w: 11.6, h: 1.9, fontFace: FONT_HEAD, fontSize: 40, bold: true, color: C.ink, valign: 'bottom', fit: 'shrink' });
  if (presentation.subtitle) {
    t.addText(presentation.subtitle, { x: 0.95, y: 3.85, w: 11.6, h: 0.8, fontFace: FONT_BODY, fontSize: 20, color: C.muted });
  }
  if (subject) {
    t.addText(subject, { x: 0.95, y: 6.4, w: 11.6, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: C.muted, italic: true });
  }

  presentation.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    paperBackground(slide);
    markerTitle(slide, s.title || `Slide ${i + 1}`);
    const bullets = (s.bullets.length ? s.bullets : ['']).map((b) => ({
      text: b,
      options: { bullet: { indent: 18 }, paraSpaceAfter: 10 },
    }));
    slide.addText(bullets, {
      x: 0.95, y: 1.55, w: 11.8, h: 5.3,
      fontFace: FONT_BODY, fontSize: 22, color: C.ink, valign: 'top', lineSpacingMultiple: 1.15, fit: 'shrink',
    });
    slide.addText(`${i + 1} / ${presentation.slides.length}`, {
      x: 11.4, y: 6.95, w: 1.6, h: 0.35, fontFace: FONT_BODY, fontSize: 11, color: C.muted, align: 'right',
    });
    if (s.speaker_notes) slide.addNotes(s.speaker_notes);
  });

  await ensureDir(path.dirname(file));
  await pptx.writeFile({ fileName: file });
  return file;
}
