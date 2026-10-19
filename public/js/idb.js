// IndexedDB storage for recordings, so audio survives a closed tab, a crash or no internet.
// Stores:
//   recordings: { lectureId, title, mime, ext, startedAt, elapsedSec, nextSeq, stopped, finished }
//   chunks:     { lectureId, seq, blob, uploaded }  key [lectureId, seq]
//   pending:    { id, lectureId, kind: 'mark' | 'photo', tSec, note, blob, mime }  (not yet sent)

const DB_NAME = 'maruza-daftari';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'lectureId' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: ['lectureId', 'seq'] });
        s.createIndex('byLecture', 'lectureId');
      }
      if (!db.objectStoreNames.contains('pending')) {
        const p = db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
        p.createIndex('byLecture', 'lectureId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let result;
        Promise.resolve(fn(t)).then((r) => (result = r), reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
      }),
  );
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const store = {
  putRecording: (rec) => tx(['recordings'], 'readwrite', (t) => t.objectStore('recordings').put(rec)),
  getRecording: (id) => tx(['recordings'], 'readonly', (t) => req2p(t.objectStore('recordings').get(id))),
  allRecordings: () => tx(['recordings'], 'readonly', (t) => req2p(t.objectStore('recordings').getAll())),

  async updateRecording(id, patch) {
    const rec = await this.getRecording(id);
    if (!rec) return null;
    const next = { ...rec, ...patch };
    await this.putRecording(next);
    return next;
  },

  putChunk: (lectureId, seq, blob) =>
    tx(['chunks'], 'readwrite', (t) => t.objectStore('chunks').put({ lectureId, seq, blob, uploaded: false })),

  markUploaded: (lectureId, seq) =>
    tx(['chunks'], 'readwrite', async (t) => {
      const s = t.objectStore('chunks');
      const c = await req2p(s.get([lectureId, seq]));
      if (c) s.put({ ...c, uploaded: true });
    }),

  chunks: (lectureId) =>
    tx(['chunks'], 'readonly', (t) => req2p(t.objectStore('chunks').index('byLecture').getAll(lectureId))).then((list) =>
      list.sort((a, b) => a.seq - b.seq),
    ),

  addPending: (item) => tx(['pending'], 'readwrite', (t) => req2p(t.objectStore('pending').add(item))),
  pending: (lectureId) =>
    tx(['pending'], 'readonly', (t) => req2p(t.objectStore('pending').index('byLecture').getAll(lectureId))),
  removePending: (id) => tx(['pending'], 'readwrite', (t) => t.objectStore('pending').delete(id)),

  /** Removes a recording and all its audio, marks and photos from the browser. */
  deleteRecording: (lectureId) =>
    tx(['recordings', 'chunks', 'pending'], 'readwrite', async (t) => {
      t.objectStore('recordings').delete(lectureId);
      for (const name of ['chunks', 'pending']) {
        const s = t.objectStore(name);
        const keys = await req2p(s.index('byLecture').getAllKeys(lectureId));
        for (const k of keys) s.delete(k);
      }
    }),
};

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
