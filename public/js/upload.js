import { api, ApiError, requireUser, toast, initTopbar } from './common.js';
import { uploadChunk } from './uploader.js';

const $ = (id) => document.getElementById(id);
const PIECE = 5 * 1024 * 1024; // 5 MB pieces get through the tunnel's request limits
const MAX_MB = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

initTopbar();
await requireUser();
for (let n = 5; n <= 20; n++) $('slides').append(new Option(`${n} ta slayd`, n, n === 10, n === 10));

$('file').addEventListener('change', () => {
  const f = $('file').files?.[0];
  if (f && !$('title').value) $('title').value = f.name.replace(/\.[^.]+$/, '').slice(0, 200);
});

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'mp3';
}

let busy = false;
window.addEventListener('beforeunload', (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});

$('go').addEventListener('click', async () => {
  const file = $('file').files?.[0];
  if (!file) return toast('Avval faylni tanlang.', { error: true });
  if (file.size > MAX_MB * 1024 * 1024) return toast(`Fayl ${Math.round(file.size / 1048576)} MB. Eng ko'pi ${MAX_MB} MB bo'lishi mumkin.`, { error: true });

  busy = true;
  $('go').disabled = true;
  $('progressBox').classList.remove('hidden');
  try {
    const { lecture } = await api('/api/lectures', {
      method: 'POST',
      json: { title: $('title').value, slideCount: Number($('slides').value), studentNotes: $('notes').value, source: 'upload' },
    });
    const total = Math.max(1, Math.ceil(file.size / PIECE));
    for (let seq = 0; seq < total; seq++) {
      const blob = file.slice(seq * PIECE, Math.min(file.size, (seq + 1) * PIECE));
      for (let attempt = 0; ; attempt++) {
        try {
          await uploadChunk(lecture.id, seq, blob);
          break;
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
          if (attempt >= 8) throw err;
          $('msg').textContent = `⚠️ ${err.message} Qayta urinilmoqda…`;
          await sleep(Math.min(30_000, 2000 * 2 ** attempt));
        }
      }
      const pct = Math.round(((seq + 1) / total) * 100);
      $('bar').style.width = `${pct}%`;
      const sentMb = Math.min(file.size, (seq + 1) * PIECE) / 1048576;
      $('msg').textContent = `Yuklanmoqda: ${pct}% (${sentMb.toFixed(1)} / ${(file.size / 1048576).toFixed(1)} MB)`;
    }
    $('msg').textContent = 'Fayl yuklandi, qayta ishlash boshlanmoqda…';
    await api(`/api/lectures/${lecture.id}/finish`, { method: 'POST', json: { totalChunks: total, ext: extOf(file.name) } });
    busy = false;
    location.href = `/lecture.html?id=${lecture.id}`;
  } catch (err) {
    busy = false;
    $('go').disabled = false;
    $('msg').textContent = '';
    toast(err.message, { error: true, ms: 8000 });
  }
});
