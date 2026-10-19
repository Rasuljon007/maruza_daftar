import { api, requireUser, toast, formatTime, formatDate, STATUS_LABELS, statusClass, h, initTopbar } from './common.js';
import { renderMarkdown } from './md.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
const BUSY = ['queued', 'transcribing', 'analyzing'];

initTopbar();
await requireUser();
if (!id) location.replace('/');

for (let n = 5; n <= 20; n++) $('slides').append(new Option(`${n} ta slayd`, n));

let data = null;
let activeTab = 'transcript';
let editing = false;
let pollTimer = null;
let summaryLang = 'uz';

async function load(full = true) {
  try {
    data = full ? await api(`/api/lectures/${id}`) : { ...data, ...(await api(`/api/lectures/${id}?full=0`)) };
  } catch (err) {
    $('title').replaceChildren(h('span', {}, '❌ ' + err.message));
    return;
  }
  render(full);
}

function render(full) {
  const l = data.lecture;
  document.title = `${l.title} · Ma'ruza Daftari`;
  $('title').replaceChildren(h('span', { class: 'mark' }, l.title));
  $('meta').textContent = [l.subject, formatDate(l.createdAt), l.durationSec ? formatTime(l.durationSec) : null].filter(Boolean).join(' · ');

  const busy = BUSY.includes(l.status);
  $('statusBox').classList.toggle('hidden', !busy);
  $('statusLabel').textContent = STATUS_LABELS[l.status] ?? l.status;
  $('statusLabel').className = `badge ${statusClass(l.status)}`;
  $('statusPct').textContent = `${l.progress}%`;
  $('statusBar').style.width = `${l.progress}%`;
  $('statusText').textContent = l.progressLabel ?? '';

  $('errorBox').classList.toggle('hidden', l.status !== 'failed');
  $('errorText').textContent = l.errorMessage ?? '';

  if (full) {
    if (document.activeElement !== $('notes')) $('notes').value = l.studentNotes ?? '';
    $('slides').value = String(l.slideCount);
    if (data.hasAudio && !$('audio').src) $('audio').src = `/api/lectures/${id}/audio`;
    $('playerBox').classList.toggle('hidden', !data.hasAudio);
    renderTabs();
  }
  $('reanalyzeBtn').disabled = busy || !data.segments?.length;

  clearTimeout(pollTimer);
  if (busy) {
    pollTimer = setTimeout(async () => {
      const before = data.lecture.status;
      await load(false);
      // Stage changed (e.g. transcript ready): fetch everything once.
      if (data.lecture.status !== before || !BUSY.includes(data.lecture.status)) await load(true);
    }, 3000);
  }
}

// ---------- tabs ----------
const TABS = [
  ['transcript', '📝 Transkript'],
  ['summary', '📒 Konspekt'],
  ['assignment', '🎯 Vazifa'],
  ['concepts', "📚 Lug'at"],
  ['materials', '❓ Materiallar'],
  ['slides', '🖼 Prezentatsiya'],
  ['photos', '📷 Rasmlar'],
];

function renderTabs() {
  const tabs = $('tabs');
  tabs.replaceChildren(
    ...TABS.map(([key, label]) =>
      h('button', {
        role: 'tab',
        'aria-selected': String(key === activeTab),
        onclick: () => {
          activeTab = key;
          editing = false;
          renderTabs();
        },
      }, label),
    ),
  );
  const panel = $('panel');
  panel.replaceChildren(...(PANELS[activeTab]?.() ?? []).flat(Infinity).filter(Boolean));
}

const a = () => data.analysis?.data;
const notReady = (what) => [
  h('p', { class: 'muted' }, BUSY.includes(data.lecture.status) ? `${what} tayyorlanmoqda…` : `${what} hali yo'q.`),
];

function seek(t) {
  const audio = $('audio');
  if (!audio.src) return;
  audio.currentTime = Math.max(0, Number(t) || 0);
  audio.play().catch(() => {});
  $('playerBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const PANELS = {
  transcript() {
    const segs = data.segments ?? [];
    if (!segs.length) return notReady('Transkript');
    const markTimes = (data.marks ?? []).map((m) => Number(m.t_sec));
    const isMarked = (s) => markTimes.some((t) => t >= Number(s.start_sec) - 2 && t <= Number(s.end_sec) + 8);
    const head = h('div', { class: 'row', style: 'justify-content: space-between; margin-bottom: 8px' },
      h('span', { class: 'small muted' }, editing ? "Gapni bosib tahrirlang. O'zgarish avtomatik saqlanadi." : "Gapni bosing: audio o'sha joydan o'ynaydi."),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { editing = !editing; renderTabs(); } }, editing ? '✔️ Tayyor' : '✏️ Tahrirlash'),
        h('a', { class: 'btn ghost', href: `/api/lectures/${id}/transcript.txt` }, '⬇️ .txt'),
      ),
    );
    const list = segs.map((s) => {
      const txt = h('span', { class: 'txt', contenteditable: editing ? 'true' : 'false' }, s.text);
      if (editing) {
        txt.addEventListener('blur', async () => {
          const text = txt.textContent.trim();
          if (!text || text === s.text) return;
          try {
            const { segment } = await api(`/api/lectures/${id}/segments/${s.id}`, { method: 'PATCH', json: { text } });
            Object.assign(s, segment);
            toast('Saqlandi', { ms: 1200 });
          } catch (err) {
            toast(err.message, { error: true });
            txt.textContent = s.text;
          }
        });
      }
      return h('div', {
        class: `seg${isMarked(s) ? ' marked' : ''}`,
        'data-start': s.start_sec,
        'data-end': s.end_sec,
        onclick: () => !editing && seek(s.start_sec),
      }, h('span', { class: 't' }, (isMarked(s) ? '⭐' : '') + formatTime(s.start_sec)), txt);
    });
    return [head, h('div', { id: 'segs' }, list)];
  },

  summary() {
    if (!a()) return notReady('Konspekt');
    const toggle = h('div', { class: 'row', style: 'margin-bottom: 8px' },
      h('button', { class: `btn ${summaryLang === 'uz' ? 'marker' : 'ghost'}`, onclick: () => { summaryLang = 'uz'; renderTabs(); } }, "O'zbekcha"),
      h('button', { class: `btn ${summaryLang === 'en' ? 'marker' : 'ghost'}`, onclick: () => { summaryLang = 'en'; renderTabs(); } }, 'English'),
    );
    const moments = a().key_moments?.length
      ? h('div', { style: 'margin-top: 12px' },
        h('h3', {}, 'Muhim lahzalar'),
        a().key_moments.map((k) => h('span', { class: 'chip', onclick: () => seek(k.t_sec) }, `${formatTime(k.t_sec)} · ${k.label_uz}`)))
      : null;
    return [toggle, h('div', { class: 'prose', html: renderMarkdown(summaryLang === 'uz' ? a().summary_uz : a().summary_en) }), moments];
  },

  assignment() {
    if (!a()) return notReady('Vazifa tahlili');
    const s = a().assignment;
    if (!s.found) {
      return [
        h('div', { class: 'notice' }, "Bu ma'ruzada aniq vazifa topilmadi. Agar professor vazifa bergan bo'lsa, pastdagi izohga yozib, \"Qayta tahlil\" ni bosing."),
        h('h3', {}, 'Seminarga qanday tayyorlanish kerak'),
        h('div', { class: 'prose', html: renderMarkdown(s.seminar_preparation_uz) }),
      ];
    }
    const list = (items) => h('ul', {}, items.map((i) => h('li', {}, i)));
    return [
      s.deadline ? h('div', { class: 'notice warn' }, h('b', {}, '⏰ Muddat: '), s.deadline) : null,
      h('h3', {}, 'Professor nima dedi'),
      h('p', {}, h('i', {}, s.professor_said)),
      h('h3', {}, 'Aniq nima qilish kerak'),
      h('div', { class: 'prose', html: renderMarkdown(s.what_to_do_uz) }),
      s.deliverables_uz.length ? [h('h3', {}, 'Nima topshiriladi'), list(s.deliverables_uz)] : null,
      s.preparation_steps_uz.length ? [h('h3', {}, 'Tayyorlanish qadamlari'), h('ol', {}, s.preparation_steps_uz.map((i) => h('li', {}, i)))] : null,
    ];
  },

  concepts() {
    if (!a()) return notReady("Lug'at");
    return [
      h('h3', {}, 'Asosiy tushunchalar'),
      ...a().key_concepts.map((c) => h('div', { style: 'margin-bottom: 10px' },
        h('b', { class: 'mark' }, c.concept), h('div', {}, c.explanation_uz), h('div', { class: 'small muted' }, c.explanation_en))),
      h('h3', { style: 'margin-top: 16px' }, "Inglizcha – o'zbekcha lug'at"),
      h('table', { class: 'gloss' },
        h('tr', {}, h('th', {}, 'English'), h('th', {}, "O'zbekcha")),
        a().glossary.map((g) => h('tr', {}, h('td', {}, h('b', {}, g.en)), h('td', {}, g.uz, g.note_uz ? h('div', { class: 'small muted' }, g.note_uz) : null)))),
    ];
  },

  materials() {
    if (!a()) return notReady('Materiallar');
    const m = a().study_materials;
    return [
      h('h3', {}, 'Savol-javoblar'),
      ...m.qa.map((q) => h('details', { style: 'margin-bottom: 8px' },
        h('summary', {}, h('b', {}, q.question_en)),
        h('p', {}, q.answer_en), h('p', { class: 'small muted' }, q.answer_uz))),
      m.examples.length ? h('h3', { style: 'margin-top: 16px' }, 'Misollar') : null,
      ...m.examples.map((e) => h('div', { class: 'slide' }, h('b', {}, e.title), h('div', { class: 'prose', html: renderMarkdown(e.content_en) }))),
      h('h3', { style: 'margin-top: 16px' }, "Qo'shimcha adabiyotlar"),
      m.further_reading.length
        ? h('ul', {}, m.further_reading.map((r) => h('li', {}, h('b', {}, r.title), r.author ? ` — ${r.author}` : '', h('div', { class: 'small muted' }, r.why_uz))))
        : h('p', { class: 'muted small' }, "AI ishonchli manba topa olmadi (soxta havola bermaslik uchun ro'yxat bo'sh)."),
    ];
  },

  slides() {
    if (!a()) return notReady('Prezentatsiya');
    const p = a().presentation;
    return [
      data.analysis.has_pptx
        ? h('a', { class: 'btn marker block', href: `/api/lectures/${id}/slides.pptx` }, '⬇️ Prezentatsiyani yuklab olish (.pptx)')
        : null,
      h('h3', { style: 'margin-top: 12px' }, p.title),
      p.subtitle ? h('p', { class: 'muted' }, p.subtitle) : null,
      ...p.slides.map((s, i) => h('div', { class: 'slide' },
        h('b', {}, `${i + 1}. ${s.title}`),
        h('ul', {}, s.bullets.map((b) => h('li', {}, b))),
        s.speaker_notes ? h('div', { class: 'notes' }, '🗣 ', s.speaker_notes) : null)),
    ];
  },

  photos() {
    const photos = data.photos ?? [];
    const marks = data.marks ?? [];
    return [
      h('h3', {}, '⭐ Muhim deb belgilangan joylar'),
      marks.length
        ? h('div', {}, marks.map((m) => h('span', { class: 'chip', onclick: () => seek(m.t_sec) }, `⭐ ${formatTime(m.t_sec)}${m.note ? ` · ${m.note}` : ''}`)))
        : h('p', { class: 'muted small' }, "Belgilangan joy yo'q."),
      h('h3', { style: 'margin-top: 16px' }, '📷 Doska rasmlari'),
      photos.length
        ? h('div', { class: 'photos' }, photos.map((p) => h('figure', { style: 'margin: 0' },
          h('img', { src: `/api/lectures/${id}/photos/${p.id}`, loading: 'lazy', alt: `Rasm ${formatTime(p.t_sec)}`, onclick: () => seek(p.t_sec) }),
          h('figcaption', { class: 'small muted center' }, formatTime(p.t_sec)))))
        : h('p', { class: 'muted small' }, "Rasm yo'q."),
    ];
  },
};

// Highlight the sentence that is playing.
$('audio').addEventListener('timeupdate', () => {
  if (activeTab !== 'transcript') return;
  const t = $('audio').currentTime;
  let current = null;
  for (const el of document.querySelectorAll('.seg')) {
    const on = t >= Number(el.dataset.start) && t < Number(el.dataset.end);
    el.classList.toggle('active', on);
    if (on) current = el;
  }
  if (current && !editing) {
    const r = current.getBoundingClientRect();
    if (r.top < 140 || r.bottom > innerHeight - 40) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});

// ---------- actions ----------
async function saveSettings() {
  const { lecture } = await api(`/api/lectures/${id}`, {
    method: 'PATCH',
    json: { studentNotes: $('notes').value, slideCount: Number($('slides').value) },
  });
  data.lecture = lecture;
}

$('saveBtn').addEventListener('click', async () => {
  try {
    await saveSettings();
    toast('Saqlandi');
  } catch (err) {
    toast(err.message, { error: true });
  }
});

$('reanalyzeBtn').addEventListener('click', async () => {
  if (!confirm("AI tahlilni qayta ishga tushiraymi? Eski konspekt va prezentatsiya yangisiga almashadi.")) return;
  try {
    const { lecture } = await api(`/api/lectures/${id}/analyze`, {
      method: 'POST',
      json: { studentNotes: $('notes').value, slideCount: Number($('slides').value) },
    });
    data.lecture = lecture;
    render(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast(err.message, { error: true });
  }
});

$('retryBtn').addEventListener('click', async () => {
  try {
    const { lecture } = await api(`/api/lectures/${id}/retry`, { method: 'POST' });
    data.lecture = lecture;
    render(false);
  } catch (err) {
    toast(err.message, { error: true });
  }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!confirm("Ma'ruza, audio va barcha natijalar butunlay o'chiriladi. Davom etaymi?")) return;
  try {
    await api(`/api/lectures/${id}`, { method: 'DELETE' });
    location.href = '/';
  } catch (err) {
    toast(err.message, { error: true });
  }
});

await load(true);
