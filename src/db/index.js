import pg from 'pg';
import { config } from '../config.js';

// NUMERIC columns come back as strings by default; timestamps/durations here fit in a double.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  // Neon may close idle connections; recycle them before that happens.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}
