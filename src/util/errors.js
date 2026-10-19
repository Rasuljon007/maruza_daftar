/** An error whose message is safe to show to the user (Uzbek). */
export class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const errors = {
  notLoggedIn: () => new AppError(401, 'Avval Telegram orqali kiring.'),
  notFound: (what = "Ma'ruza") => new AppError(404, `${what} topilmadi. U o'chirilgan bo'lishi mumkin.`),
  badRequest: (msg) => new AppError(400, msg),
  tooLarge: (mb) => new AppError(413, `Fayl juda katta. Eng ko'pi ${mb} MB yuklash mumkin.`),
  busy: () => new AppError(409, "Bu ma'ruza hozir qayta ishlanmoqda. Tugashini kuting."),
};

/** Wraps an async route handler so thrown errors reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Turns provider/network errors into a short Uzbek explanation for the lecture page. */
export function describeJobError(err, stage) {
  const status = err?.status ?? err?.statusCode ?? err?.code;
  const where = stage === 'transcribe' ? 'Transkripsiya' : stage === 'analyze' ? 'AI tahlil' : 'Prezentatsiya';
  if (status === 401 || status === 403) {
    return `${where}: API kaliti noto'g'ri yoki ruxsat yo'q. .env dagi kalitni tekshiring va "Qayta urinish" ni bosing.`;
  }
  if (status === 429) {
    return `${where}: tekin limit vaqtincha tugadi. Bir oz kutib (1 soatgacha), "Qayta urinish" ni bosing.`;
  }
  if (status === 413) {
    return `${where}: audio bo'lagi juda katta bo'lib chiqdi. Iltimos, xatoni menga xabar qiling.`;
  }
  if (['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(err?.code)) {
    return `${where}: internet bilan muammo. Noutbuk internetga ulanganini tekshirib, "Qayta urinish" ni bosing.`;
  }
  if (err instanceof AppError) return `${where}: ${err.message}`;
  return `${where}da kutilmagan xato: ${String(err?.message ?? err).slice(0, 200)}. "Qayta urinish" ni bosing.`;
}
