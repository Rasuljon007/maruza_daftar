import { api, requireUser, formatTime, formatDate, STATUS_LABELS, statusClass, h, initTopbar } from './common.js';
import { store } from './idb.js';
import { finishRecording } from './uploader.js';

const $ = (id) => document.getElementById(id);
initTopbar();
const user = await requireUser();
if (user.first_name) $('hello').replaceChildren(h('span', { class: 'mark' }, `Salom, ${user.first_name}!`));

$('logout').addEventListener('click', async () => {
  if (!confirm('Saytdan chiqasizmi?')) return;
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

/** Recordings left in this browser (tab closed, phone died, no internet) can be sent from here. */
async function renderRecovery() {
  const box = $('recovery');
  box.innerHTML = '';
  let recs = [];
  try {
    recs = (await store.allRecordings()).filter((r) => !r.finished);
  } catch {
    return;
  }
  for (const rec of recs) {
    const chunks = await store.chunks(rec.lectureId);
    if (!chunks.length) {
      await store.deleteRecording(rec.lectureId);
      continue;
    }
    const msg = h('div', { class: 'small muted' });
    const sendBtn = h('button', { class: 'btn marker' }, '♻️ Tiklash va yuborish');
    const delBtn = h('button', { class: 'btn danger' }, "O'chirish");
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = delBtn.disabled = true;
      msg.textContent = 'Yuborilmoqda…';
      try {
        const lecture = await finishRecording(rec.lectureId, ({ pending, error }) => {
          msg.textContent = error ? `⚠️ ${error.message} Qayta urinilmoqda…` : `Qoldi: ${Math.max(0, pending)} bo'lak`;
        });
        await store.deleteRecording(rec.lectureId);
        location.href = `/lecture.html?id=${lecture.id}`;
      } catch (err) {
        sendBtn.disabled = delBtn.disabled = false;
        msg.textContent = `❌ ${err.message}`;
      }
    });
    delBtn.addEventListener('click', async () => {
      if (!confirm("Bu yozuv telefondan butunlay o'chiriladi. Ishonchingiz komilmi?")) return;
      await store.deleteRecording(rec.lectureId);
      api(`/api/lectures/${rec.lectureId}`, { method: 'DELETE' }).catch(() => {});
      renderRecovery();
    });
    box.append(
      h('section', { class: 'card stack', style: 'border-color: var(--danger)' },
        h('h2', {}, '⚠️ Tugallanmagan yozuv bor'),
        h('p', {}, `"${rec.title || "Nomsiz ma'ruza"}" · ${formatDate(rec.startedAt)} · taxminan ${formatTime(rec.elapsedSec || chunks.length * 10)}`),
        h('p', { class: 'small muted' }, "Yozuv telefonda saqlanib qolgan. Uni serverga yuborib, matn va konspektga aylantirish mumkin."),
        h('div', { class: 'row' }, sendBtn, delBtn),
        msg,
      ),
    );
  }
}

async function renderList() {
  const list = $('list');
  try {
    const { lectures } = await api('/api/lectures');
    list.innerHTML = '';
    const shown = lectures.filter((l) => l.status !== 'recording');
    if (!shown.length) {
      list.append(h('p', { class: 'muted center' }, "Hali ma'ruza yo'q. Birinchisini yozib oling!"));
      return;
    }
    for (const l of shown) {
      list.append(
        h('a', { class: 'card lecture-item', href: `/lecture.html?id=${l.id}` },
          h('div', { class: 'row', style: 'justify-content: space-between' },
            h('span', { class: 'title' }, l.title),
            h('span', { class: `badge ${statusClass(l.status)}` }, STATUS_LABELS[l.status] ?? l.status),
          ),
          h('div', { class: 'small muted' },
            [l.subject, formatDate(l.createdAt), l.durationSec ? formatTime(l.durationSec) : null].filter(Boolean).join(' · '),
          ),
          ['queued', 'transcribing', 'analyzing'].includes(l.status)
            ? h('div', { class: 'progress', style: 'margin-top: 8px' }, h('div', { style: `width: ${l.progress}%` }))
            : null,
        ),
      );
    }
    if (shown.some((l) => ['queued', 'transcribing', 'analyzing'].includes(l.status))) setTimeout(renderList, 5000);
  } catch (err) {
    list.innerHTML = '';
    list.append(h('div', { class: 'notice warn' }, err.message));
  }
}

renderRecovery();
renderList();
window.addEventListener('pageshow', (e) => e.persisted && renderList());
