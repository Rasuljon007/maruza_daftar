import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { ensureDir } from '../storage/local.js';

export const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;

/** Runs ffmpeg and resolves with its stderr (ffmpeg logs everything there). */
export function runFfmpeg(args, { timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg topilmadi. `npm install` ni qayta ishga tushiring."));
      return;
    }
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg xato bilan tugadi (kod ${code}): ${stderr.split('\n').slice(-6).join(' ').trim()}`));
    });
  });
}

/** Reads a media file's duration (seconds) from ffmpeg's banner; null if unknown. */
export async function probeDuration(file) {
  // `-f null -` decodes the whole file, which also gives a reliable duration for
  // MediaRecorder webm files whose header has no duration.
  const stderr = await runFfmpeg(['-i', file, '-vn', '-f', 'null', '-']);
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.at(-1);
  if (last) return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Any audio/video -> mono 16 kHz MP3 (~32 kbps): small, and plenty for speech recognition. */
export async function compressForSpeech(input, output) {
  await ensureDir(path.dirname(output));
  await runFfmpeg(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-codec:a', 'libmp3lame', output]);
  return output;
}

/**
 * Splits an MP3 into parts of `seconds` length (stream copy, no re-encode).
 * Returns [{ file, offset, duration }] with real offsets measured from each part.
 */
export async function splitAudio(input, outDir, seconds = 600) {
  await fs.rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);
  await runFfmpeg([
    '-y', '-i', input, '-f', 'segment', '-segment_time', String(seconds),
    '-reset_timestamps', '1', '-c', 'copy', path.join(outDir, 'part_%03d.mp3'),
  ]);
  const files = (await fs.readdir(outDir)).filter((f) => /^part_\d+\.mp3$/.test(f)).sort();
  // The segment muxer cuts on MP3 frame boundaries (~26 ms), so nominal offsets are
  // more accurate than summing decoded durations (which lose encoder padding).
  const parts = files.map((f, i) => ({ file: path.join(outDir, f), offset: i * seconds, duration: seconds }));
  if (parts.length) {
    const last = parts.at(-1);
    last.duration = (await probeDuration(last.file)) ?? seconds;
    if (last.duration < 0.3 && parts.length > 1) parts.pop(); // empty tail segment
  }
  return parts;
}
