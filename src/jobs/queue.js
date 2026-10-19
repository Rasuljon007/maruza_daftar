import { PgBoss } from 'pg-boss';
import { config } from '../config.js';

export const QUEUES = { transcribe: 'transcribe', analyze: 'analyze' };

let boss;

export async function startQueue() {
  boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss', max: 3 });
  boss.on('error', (err) => console.error('[queue]', err.message));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    // Retries are handled inside the jobs (per audio part), so the queue itself does not retry.
    await boss.createQueue(name, { retryLimit: 0, expireInSeconds: 3 * 60 * 60 });
  }
  return boss;
}

export async function stopQueue() {
  await boss?.stop({ graceful: true, timeout: 10_000 });
}

export function enqueue(name, data) {
  if (!boss) throw new Error('Queue not started');
  return boss.send(name, data);
}

/** Registers a single-job-at-a-time worker; the laptop should not run two heavy jobs at once. */
export async function work(name, handler) {
  await boss.work(name, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    await handler(job.data);
  });
}
