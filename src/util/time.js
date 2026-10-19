/** 75.4 -> "01:15", 3725 -> "1:02:05" */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries fn on transient errors with exponential backoff; honours HTTP 429 retry hints. */
export async function withRetry(fn, { attempts = 3, baseMs = 2000, onRetry } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413) throw err;
      if (i === attempts - 1) break;
      let wait = baseMs * 2 ** i;
      const retryAfter = Number(err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after']);
      if (status === 429) wait = Math.min(Math.max(wait, (retryAfter || 20) * 1000), 120_000);
      onRetry?.(err, i + 1, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}
