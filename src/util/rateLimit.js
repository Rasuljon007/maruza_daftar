import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const json = (message) => (_req, res) => res.status(429).json({ error: message });

/** General API limit per user (or per IP before login). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300, // recording uploads a chunk every few seconds, so keep this generous
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
  validate: { keyGeneratorIpFallback: false },
  handler: json("Juda ko'p so'rov yuborildi. Bir daqiqa kutib, qayta urinib ko'ring."),
});

/** Limits actions that spend AI quota (transcription, analysis). */
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.limits.aiPerHour,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `u:${req.session?.userId ?? req.ip}`,
  validate: { keyGeneratorIpFallback: false },
  handler: json("Bir soatlik AI so'rovlar chegarasiga yetdingiz. Birozdan keyin qayta urinib ko'ring."),
});

/** Login attempts per IP. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: json("Kirishga juda ko'p urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring."),
});
