import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Directory that holds everything for one lecture: chunks, audio, photos, slides. */
export function lectureDir(lectureId) {
  if (!UUID_RE.test(lectureId)) throw new Error('Invalid lecture id');
  return path.join(config.storageDir, 'lectures', lectureId);
}

export const paths = {
  chunksDir: (id) => path.join(lectureDir(id), 'chunks'),
  chunk: (id, seq) => path.join(lectureDir(id), 'chunks', `${String(seq).padStart(6, '0')}.part`),
  original: (id, ext) => path.join(lectureDir(id), `original.${ext}`),
  audio: (id) => path.join(lectureDir(id), 'audio.mp3'),
  workDir: (id) => path.join(lectureDir(id), 'work'),
  photosDir: (id) => path.join(lectureDir(id), 'photos'),
  photo: (id, fileName) => path.join(lectureDir(id), 'photos', path.basename(fileName)),
  pptx: (id) => path.join(lectureDir(id), 'slides.pptx'),
};

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeFileAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Concatenates chunk files 0..count-1 into one file (MediaRecorder chunks form one stream). */
export async function concatChunks(lectureId, count, target) {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    for (let seq = 0; seq < count; seq++) {
      // Chunks are at most a few MB, so reading each one whole is fine.
      await fh.write(await fs.readFile(paths.chunk(lectureId, seq)));
    }
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, target);
}

export async function removeLecture(lectureId) {
  await fs.rm(lectureDir(lectureId), { recursive: true, force: true });
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
