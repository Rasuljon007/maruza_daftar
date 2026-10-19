import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies every migrations/*.sql file once, in name order. */
export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`[migrate] ${file} ✓`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} bajarilmadi: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => {
      console.log("[migrate] Ma'lumotlar bazasi tayyor.");
      return pool.end();
    })
    .catch((err) => {
      console.error(`[migrate] Xato: ${err.message}`);
      process.exit(1);
    });
}
