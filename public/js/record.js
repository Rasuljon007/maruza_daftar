import { api, requireUser, toast, formatTime, initTopbar } from './common.js';
import { store, requestPersistence } from './idb.js';
import { syncRecording, finishRecording } from './uploader.js';
import { prepareImage } from './images.js';

const $ = (id) => document.getElementById(id);
const SLICE_MS = 10_000; // MediaRecorder hands us audio every 10 s -> IndexedDB
const SYNC_MS = 30_000; // and we push it to the server every 30 s

let lectureId = null;
let recorder = null;
let stream = null;
let seq = 0;
let startedAt = 0;
let timerId = null;
let syncId = null;
let wakeLock = null;
let audioCtx = null;
let saving = Promise.resolve();
let marksCount = 0;
let photosCount = 0;

initTopbar();
await requireUser();

for (let n = 5; n <= 20; n++) $('slides').append(new Option(`${n} ta slayd`, n, n === 10, n === 10));

function pickFormat() {
  const candidates = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mp4', 'm4a'], // Safari / iPhone
  ];
  for (const [mime, ext] of candidates) if (window.MediaRecorder?.isTypeSupported?.(mime)) return { mime, ext };
  return { mime: '', ext: 'webm' };
}

const elapsed = () => (performance.now() - startedAt) / 1000;

function micErrorText(err) {
  if (err?.name === 'NotAllowedError') return "Mikrofonga ruxsat berilmadi. Brauzer sozlamalarida bu saytga mikrofon ruxsatini yoqing va qayta urinib ko'ring.";
  if (err?.name === 'NotFoundError') return 'Mikrofon topilmadi. Telefon yoki noutbukda mikrofon borligini tekshiring.';
  if (!window.isSecureContext) return "Mikrofon faqat https manzilda ishlaydi. Saytni bot yuborgan https manzil orqali oching.";
  if (!window.MediaRecorder) return "Bu brauzer yozib olishni qo'llab-quvvatlamaydi. Chrome yoki Safari'ning yangi versiyasidan foydalaning.";
  return `Mikrofonni ochib bo'lmadi: ${err?.message ?? err}`;
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    /* battery saver may refuse; recording still works */
  }
}

function showLevel(s) {
  try {
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(s).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const bar = $('level');
    const tick = () => {
      if (!recorder || recorder.state === 'inactive') return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      bar.style.width = `${Math.min(100, (peak / 128) * 140)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* meter is optional */
  }
}

function setSync(text) {
  $('sync').textContent = text;
}

async function sync() {
  if (!lectureId) return;
  if (!navigator.onLine) {
    setSync('📴 Internet yo\'q. Audio telefonda saqlanmoqda, keyin yuboriladi.');
    return;
  }
  const r = await syncRecording(lectureId);
  if (r.error) setSync(`⚠️ Serverga yuborilmadi, telefonda saqlanmoqda. Keyinroq yana urinaman.`);
  else setSync(`✅ Saqlandi · ${new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
}

async function start() {
  $('startBtn').disabled = true;
  const { mime, ext } = pickFormat();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: false, channelCount: 1 },
    });
  } catch (err) {
    $('startBtn').disabled = false;
    toast(micErrorText(err), { error: true, ms: 8000 });
    return;
  }

  lectureId = crypto.randomUUID();
  const title = $('title').value.trim();
  const slideCount = Number($('slides').value);
  await store.putRecording({
    lectureId, title, slideCount, mime, ext, startedAt: Date.now(), elapsedSec: 0, nextSeq: 0,
    stopped: false, finished: false, serverCreated: false,
  });
  requestPersistence();
  // Try to create it on the server right away; if offline, the uploader does it later.
  api('/api/lectures', { method: 'POST', json: { id: lectureId, title, slideCount, source: 'recording' } })
    .then(() => store.updateRecording(lectureId, { serverCreated: true }))
    .catch(() => setSync("📴 Server bilan aloqa yo'q. Audio telefonda saqlanmoqda."));

  recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    const mySeq = seq++;
    saving = saving.then(async () => {
      await store.putChunk(lectureId, mySeq, e.data);
      await store.updateRecording(lectureId, { nextSeq: seq, elapsedSec: Math.round(elapsed()) });
    }).catch((err) => toast(`Telefonda saqlashda xato: ${err.message}. Xotira to'lgan bo'lishi mumkin.`, { error: true, ms: 8000 }));
  };
  recorder.onerror = (e) => toast(`Yozishda xato: ${e.error?.message ?? 'nomaʼlum'}`, { error: true });
  recorder.start(SLICE_MS);
  startedAt = performance.now();

  $('setup').classList.add('hidden');
  $('recording').classList.remove('hidden');
  $('recTitle').textContent = title ? `Yozilmoqda: ${title}` : 'Yozilmoqda';
  timerId = setInterval(() => ($('timer').textContent = formatTime(elapsed())), 500);
  syncId = setInterval(sync, SYNC_MS);
  keepAwake();
  showLevel(stream);
  setSync('Yozish boshlandi.');
}

async function stop() {
  if (!recorder) return;
  if (!confirm("Yozishni tugatib, ma'ruzani yuboraymi?")) return;
  $('stopBtn').disabled = true;
  const stopped = new Promise((r) => (recorder.onstop = r));
  recorder.stop();
  await stopped;
  await saving;
  stream.getTracks().forEach((t) => t.stop());
  clearInterval(timerId);
  clearInterval(syncId);
  audioCtx?.close();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  await store.updateRecording(lectureId, { stopped: true, elapsedSec: Math.round(elapsed()) });

  $('recording').classList.add('hidden');
  $('finishing').classList.remove('hidden');
  const total = seq || 1;
  try {
    const lecture = await finishRecording(lectureId, ({ pending, error }) => {
      if (pending >= 0) $('finishBar').style.width = `${Math.round(((total - pending) / total) * 90) + 10}%`;
      $('finishMsg').textContent = error
        ? `⚠️ ${error.message} Qayta urinilmoqda… (audio telefonda saqlangan)`
        : `Audio yuborilmoqda… qoldi: ${Math.max(0, pending)} bo'lak`;
    });
    $('finishBar').style.width = '100%';
    await store.deleteRecording(lectureId);
    recorder = null;
    location.href = `/lecture.html?id=${lecture.id}`;
  } catch (err) {
    recorder = null;
    $('finishMsg').textContent = `❌ ${err.message} Audio telefonda saqlangan: bosh sahifada "Tiklash" tugmasi orqali qayta yuborishingiz mumkin.`;
  }
}

function addMark() {
  if (!lectureId) return;
  const tSec = Math.max(0, elapsed() - 5); // the important bit usually started a few seconds earlier
  store.addPending({ lectureId, kind: 'mark', tSec: Number(tSec.toFixed(1)), note: '' });
  marksCount++;
  $('markInfo').textContent = `⭐ ${marksCount} ta muhim joy · 📷 ${photosCount} ta rasm`;
  navigator.vibrate?.(60);
  toast(`⭐ ${formatTime(tSec)} muhim deb belgilandi`, { ms: 1800 });
}

async function savePhoto(blob, tSec) {
  const prepared = await prepareImage(blob);
  await store.addPending({ lectureId, kind: 'photo', tSec: Number(tSec.toFixed(1)), blob: prepared, mime: prepared.type || 'image/jpeg' });
  photosCount++;
  $('markInfo').textContent = `⭐ ${marksCount} ta muhim joy · 📷 ${photosCount} ta rasm`;
  toast('📷 Rasm saqlandi', { ms: 1800 });
}

// --- in-page camera ---
let camStream = null;
let camT = 0;
async function openCamera() {
  camT = elapsed();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } });
  } catch {
    $('photoInput').click(); // fall back to the system camera
    return;
  }
  const v = $('cameraVideo');
  v.srcObject = camStream;
  await v.play().catch(() => {});
  $('camera').classList.remove('hidden');
}
function closeCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('camera').classList.add('hidden');
}
async function takeShot() {
  const v = $('cameraVideo');
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  closeCamera();
  if (blob) await savePhoto(blob, camT);
}

$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('markBtn').addEventListener('click', addMark);
$('photoBtn').addEventListener('click', openCamera);
$('cameraCancel').addEventListener('click', closeCamera);
$('cameraShot').addEventListener('click', takeShot);
$('photoInput').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) await savePhoto(f, camT);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && recorder?.state === 'recording') keepAwake();
});
window.addEventListener('online', () => recorder && sync());
window.addEventListener('beforeunload', (e) => {
  if (recorder && recorder.state !== 'inactive') {
    e.preventDefault();
    e.returnValue = '';
  }
});
// Last chance to save what we have when the page is being hidden/closed.
window.addEventListener('pagehide', () => {
  if (recorder?.state === 'recording') recorder.requestData();
});
