import crypto from 'node:crypto';
import { Router } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config, botLink } from '../config.js';
import { pool, one, query } from '../db/index.js';
import { errors, wrap } from '../util/errors.js';

const LOGIN_TTL_MIN = 10;

export function sessionMiddleware() {
  const PgStore = connectPgSimple(session);
  return session({
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: true, pruneSessionInterval: 60 * 60 }),
    name: 'md.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto', // https through the tunnel, plain http on localhost
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  });
}

export function requireAuth(req, _res, next) {
  if (req.session?.userId) next();
  else next(errors.notLoggedIn());
}

export const authRouter = Router();

/** Step 1: browser asks for a one-time token and opens the bot with it. */
authRouter.post(
  '/start',
  wrap(async (req, res) => {
    if (!config.telegram.username) throw errors.badRequest(".env da TELEGRAM_BOT_USERNAME bo'sh.");
    const token = crypto.randomBytes(16).toString('hex');
    await query(`INSERT INTO login_tokens (token, expires_at) VALUES ($1, now() + interval '${LOGIN_TTL_MIN} minutes')`, [token]);
    await query('DELETE FROM login_tokens WHERE expires_at < now() - interval \'1 day\'');
    req.session.loginToken = token;
    res.json({ botUrl: botLink(`login_${token}`), expiresInSec: LOGIN_TTL_MIN * 60 });
  }),
);

/** Step 2: browser polls until the user pressed "Tasdiqlash" in the bot. */
authRouter.get(
  '/poll',
  wrap(async (req, res) => {
    const token = req.session.loginToken;
    if (req.session.userId) return res.json({ loggedIn: true });
    if (!token) return res.json({ loggedIn: false, expired: true });
    const row = await one('SELECT user_id, confirmed_at, expires_at < now() AS expired FROM login_tokens WHERE token = $1', [token]);
    if (row?.confirmed_at && row.user_id) {
      await query('DELETE FROM login_tokens WHERE token = $1', [token]);
      await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
      req.session.userId = row.user_id;
      return res.json({ loggedIn: true });
    }
    res.json({ loggedIn: false, expired: !row || row.expired });
  }),
);

authRouter.get(
  '/me',
  wrap(async (req, res) => {
    if (!req.session.userId) return res.json({ user: null, botUsername: config.telegram.username });
    const user = await one('SELECT id, first_name, username FROM users WHERE id = $1', [req.session.userId]);
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ user: null, botUsername: config.telegram.username });
    }
    res.json({ user, botUsername: config.telegram.username });
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
