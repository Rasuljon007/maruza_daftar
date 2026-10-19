// Sends recording chunks from IndexedDB to the server in order, retrying until they arrive.
import { api, ApiError } from './common.js';
import { store } from './idb.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function uploadChunk(lectureId, seq, blob) {
  return api(`/api/lectures/${lectureId}/chunks/${seq}`, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

/**
 * Uploads every not-yet-uploaded chunk of a recording. Safe to call repeatedly; only one
 * run per lecture is active at a time.
 * @returns {Promise<{ pending: number, error?: Error }>}
 */
const running = new Map();

/** Creates the lecture on the server if the recording was started offline. */
async function ensureServerLecture(rec) {
  if (rec.serverCreated) return;
  await api('/api/lectures', {
    method: 'POST',
    json: { id: rec.lectureId, title: rec.title, slideCount: rec.slideCount, source: 'recording' },
  });
  await store.updateRecording(rec.lectureId, { serverCreated: true });
}

/** Sends "Muhim!" marks and photos taken during the recording. */
async function syncPending(lectureId) {
  for (const item of await store.pending(lectureId)) {
    if (item.kind === 'mark') {
      await api(`/api/lectures/${lectureId}/marks`, { method: 'POST', json: { tSec: item.tSec, note: item.note ?? '' } });
    } else if (item.kind === 'photo') {
      await api(`/api/lectures/${lectureId}/photos?t=${item.tSec}`, {
        method: 'POST',
        body: item.blob,
        headers: { 'Content-Type': item.mime },
      });
    }
    await store.removePending(item.id);
  }
}

export function syncRecording(lectureId, onState) {
  if (running.has(lectureId)) return running.get(lectureId);
  const p = (async () => {
    const rec = await store.getRecording(lectureId);
    if (!rec) return { pending: 0 };
    try {
      await ensureServerLecture(rec);
      await syncPending(lectureId);
    } catch (err) {
      onState?.({ pending: -1, error: err });
      return { pending: -1, error: err };
    }
    const chunks = await store.chunks(lectureId);
    const todo = chunks.filter((c) => !c.uploaded);
    let done = 0;
    for (const c of todo) {
      try {
        await uploadChunk(lectureId, c.seq, c.blob);
        await store.markUploaded(lectureId, c.seq);
        done++;
        onState?.({ pending: todo.length - done });
      } catch (err) {
        onState?.({ pending: todo.length - done, error: err });
        return { pending: todo.length - done, error: err };
      }
    }
    return { pending: 0 };
  })().finally(() => running.delete(lectureId));
  running.set(lectureId, p);
  return p;
}

/**
 * Makes sure all chunks are on the server, then asks it to start processing.
 * Retries with backoff while offline. Returns the server's lecture object.
 */
export async function finishRecording(lectureId, onState) {
  const rec = await store.getRecording(lectureId);
  if (!rec) throw new Error("Yozuv brauzerda topilmadi.");
  for (let attempt = 0; ; attempt++) {
    const r = await syncRecording(lectureId, onState);
    if (!r.error) {
      const total = (await store.chunks(lectureId)).length;
      if (!total) throw new Error("Yozuvda audio yo'q. Mikrofon ishlaganini tekshiring.");
      try {
        const { lecture } = await api(`/api/lectures/${lectureId}/finish`, {
          method: 'POST',
          json: { totalChunks: total, ext: rec.ext },
        });
        await store.updateRecording(lectureId, { finished: true });
        return lecture;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && Array.isArray(err.body?.missing)) {
          // Server lost some pieces: mark them as not uploaded and send again.
          for (const seq of err.body.missing) {
            const c = (await store.chunks(lectureId)).find((x) => x.seq === seq);
            if (c) await store.putChunk(lectureId, seq, c.blob);
          }
          continue;
        }
        if (err instanceof ApiError && err.status !== 0 && err.status < 500 && err.status !== 429) throw err;
        onState?.({ pending: 0, error: err });
      }
    } else if (r.error instanceof ApiError && r.error.status >= 400 && r.error.status < 500 && r.error.status !== 429) {
      throw r.error;
    }
    await sleep(Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4)));
  }
}
