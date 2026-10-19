import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { one, many, query } from '../db/index.js';

let bot = null;

function siteText() {
  return config.appUrl
    ? `🌐 Sayt manzili: ${config.appUrl}`
    : "🌐 Sayt hozir o'chiq (noutbuk serveri ishlamayapti). Birozdan keyin qayta urinib ko'ring.";
}

/** Starts the bot in long-polling mode (no public URL needed). */
export async function startBot() {
  if (!config.telegram.enabled) return null;
  if (!config.telegram.token) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN is empty, the bot is disabled.');
    return null;
  }
  bot = new Bot(config.telegram.token);

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim() ?? '';
    if (payload.startsWith('login_')) {
      const token = payload.slice('login_'.length);
      const row = await one('SELECT token FROM login_tokens WHERE token = $1 AND expires_at > now() AND confirmed_at IS NULL', [token]);
      if (!row) {
        await ctx.reply("Bu kirish havolasining muddati tugagan. Saytda \"Telegram orqali kirish\" tugmasini qayta bosing.");
        return;
      }
      await ctx.reply("Ma'ruza Daftari saytiga kirishni tasdiqlaysizmi?", {
        reply_markup: new InlineKeyboard().text('✅ Tasdiqlash', `login:${token}`).text('❌ Bekor qilish', 'login:cancel'),
      });
      return;
    }
    await ctx.reply(
      `Assalomu alaykum! Men Ma'ruza Daftari botiman.\n\nSaytda ma'ruzani yozib olasiz, men esa natija tayyor bo'lganda xabar beraman.\n\n${siteText()}\n\nSayt manzilini istalgan payt /sayt buyrug'i bilan olasiz.`,
    );
  });

  bot.command('sayt', (ctx) => ctx.reply(siteText()));

  bot.callbackQuery(/^login:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    if (token === 'cancel') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('Kirish bekor qilindi.');
      return;
    }
    const from = ctx.from;
    const user = await one(
      `INSERT INTO users (telegram_id, first_name, username) VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name, username = EXCLUDED.username
       RETURNING id`,
      [from.id, from.first_name ?? null, from.username ?? null],
    );
    const res = await query(
      'UPDATE login_tokens SET user_id = $2, confirmed_at = now() WHERE token = $1 AND expires_at > now() AND confirmed_at IS NULL',
      [token, user.id],
    );
    await ctx.answerCallbackQuery();
    if (res.rowCount) {
      await ctx.editMessageText("✅ Kirdingiz! Brauzerga qayting, sahifa o'zi yangilanadi.");
    } else {
      await ctx.editMessageText("Havola muddati tugagan. Saytda \"Telegram orqali kirish\" tugmasini qayta bosing.");
    }
  });

  bot.catch((err) => console.error('[bot]', err.error?.message ?? err.message));

  await bot.api.setMyCommands([
    { command: 'start', description: 'Boshlash' },
    { command: 'sayt', description: 'Sayt manzilini olish' },
  ]);
  // Long polling: drop updates that piled up while the laptop was off.
  bot.start({ drop_pending_updates: true, onStart: (me) => console.log(`[bot] @${me.username} ishga tushdi`) });
  return bot;
}

export async function stopBot() {
  await bot?.stop();
}

/** Tells every known user the site's new address (the free tunnel URL changes on restart). */
export async function broadcastSiteUrl() {
  if (!bot || !config.appUrl) return;
  const users = await many('SELECT telegram_id FROM users');
  for (const u of users) {
    await bot.api
      .sendMessage(u.telegram_id, `Server qayta ishga tushdi.\n${siteText()}\n\nEski manzil endi ishlamaydi, saytga qaytadan kiring.`)
      .catch((err) => console.warn(`[bot] could not message ${u.telegram_id}: ${err.message}`));
  }
}

export async function notifyLectureReady(lectureId) {
  if (!bot) return;
  const row = await one(
    'SELECT l.title, u.telegram_id FROM lectures l JOIN users u ON u.id = l.user_id WHERE l.id = $1',
    [lectureId],
  );
  if (!row) return;
  const link = config.appUrl ? `\n${config.appUrl}/lecture.html?id=${lectureId}` : '';
  await bot.api.sendMessage(row.telegram_id, `✅ "${row.title}" tayyor: konspekt, vazifa tahlili va prezentatsiya.${link}`);
}
