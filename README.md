# Ma'ruza Daftari

Ingliz tilidagi ma'ruzalarni yozib oladi, matnga aylantiradi va AI yordamida konspekt, lug'at, vazifa tahlili hamda prezentatsiya (.pptx) tayyorlaydi. Veb-ilova telefonda ishlaydi, kirish Telegram bot orqali bo'ladi.

> 📌 Yozib olishdan oldin professordan ruxsat oling.
> 🎓 AI materiallari tayyorlanish uchun yordamchi vosita, tayyor ish sifatida topshirish uchun emas.

## Qanday ishlaydi

- **Server** sizning noutbukingizda ishlaydi, audio va rasmlar `STORAGE_DIR` papkasida saqlanadi.
- **Internetga chiqish** Cloudflare tunnel orqali bo'ladi. `npm start` har safar yangi `https://...trycloudflare.com` manzil oladi va bot uni sizga yuboradi.
- **Ma'lumotlar bazasi** Neon (tekin bulutli PostgreSQL).
- **Transkripsiya** Groq `whisper-large-v3-turbo` (tekin).
- **Tahlil** Google Gemini (tekin).
- **Telegram bot** long polling rejimida ishlaydi, webhook kerak emas.

Noutbuk o'chsa yoki uxlab qolsa sayt ham ishlamaydi. `npm start` ishlab turganda Windows'ning uyqu rejimi avtomatik o'chiriladi (ekran o'chishi mumkin, bu normal). Qopqoqni yopsangiz baribir uxlaydi: buni Boshqaruv paneli → Quvvat sozlamalari → "Qopqoq yopilganda" → "Hech narsa qilmaslik" orqali o'zgartirish mumkin. Bu xususiyatni o'chirish uchun `.env` ga `KEEP_AWAKE=false` yozing. Yozib olish esa telefonda davom etadi va server qaytgach yuboriladi.

## Birinchi o'rnatish (Windows, PowerShell)

1. Node.js 20 yoki undan yangisi va `cloudflared` o'rnatilgan bo'lsin.
2. Loyihani yuklab oling:
   ```powershell
   cd D:\
   git clone https://github.com/Rasuljon007/maruza_daftar.git maruza-daftar
   cd D:\maruza-daftar
   npm install
   ```
3. `.env` faylini tayyorlang: `copy .env.example .env`, keyin uni Notepad'da ochib kalitlarni o'zingiz yozing. `.env` hech qachon GitHub'ga yuklanmaydi.
4. Bazani tayyorlang: `npm run migrate`
5. Kalitlarni tekshiring: `npm run check-keys`. Har bir qatorda ✅ bo'lishi kerak; kalit qiymatlari ekranga chiqmaydi.
6. Ishga tushiring: `npm start`. Terminalda sayt manzili chiqadi va bot uni Telegram'da yuboradi.

## Har kungi ishlatish

- Noutbukda `D:\maruza-daftar\start-server.cmd` faylini ikki marta bosing. Server to'xtab qolsa (masalan, tunnel uzilsa) u 10 soniyada o'zi qayta yoqiladi va bot yangi manzilni yuboradi.
- Windows'ga kirganda o'zi ishga tushishi uchun bir marta `scripts\windows\autostart-yoqish.cmd` ni bosing (o'chirish: `autostart-ochirish.cmd`).
- Telefonda botga `/sayt` yozing va kelgan havolani oching.
- Kirish uchun "Telegram orqali kirish" tugmasini bosing va botda "Tasdiqlash"ni bosing.
- To'xtatish uchun terminalda `Ctrl+C`.

## Buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `npm start` | Server, bot va Cloudflare tunnel |
| `npm run server` | Faqat server (tunnelsiz, `http://127.0.0.1:3000`) |
| `npm run migrate` | Baza jadvallarini yaratadi/yangilaydi |
| `npm run check-keys` | Barcha kalitlar va ulanishlar ishlashini tekshiradi |
| `npm test` | Avtomatik testlar (`TEST_DATABASE_URL` kerak, alohida sinov bazasi) |

## AI provayderni almashtirish

`.env` ichida:

- Tahlil uchun Claude: `AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5-5`, `ANTHROPIC_API_KEY=...`
- Transkripsiya uchun OpenAI: `TRANSCRIBE_PROVIDER=openai`, `TRANSCRIBE_MODEL=whisper-1`, `OPENAI_API_KEY=...`
- AI'siz sinov rejimi: `AI_PROVIDER=fake`, `TRANSCRIBE_PROVIDER=fake`

## Tekin limitlar

- Groq: soatiga 2 soat audio, kuniga 8 soat audio. 90 daqiqalik ma'ruza bemalol sig'adi.
- Gemini tekin tarifi: kunlik so'rovlar soni cheklangan; Google tekin tarifdagi ma'lumotlarni modelni yaxshilash uchun ishlatishi mumkin.
- Limit tugasa ma'ruza "Xato" holatiga o'tadi va o'zbekcha sabab ko'rsatiladi. Keyinroq "Qayta urinish" tugmasini bosing.

## Loyiha tuzilishi

```
src/
  server.js          Express ilova va ishga tushirish
  config.js          .env sozlamalari
  auth/              Telegram orqali kirish, sessiyalar
  bot/               Telegram bot (grammY)
  routes/lectures.js Ma'ruzalar API (bo'laklab yuklash, belgilar, rasmlar, audio)
  jobs/              Fon vazifalari: transcribe -> analyze (pg-boss)
  ai/                Transkripsiya, tahlil promptlari va LLM provayderlar
  media/             ffmpeg (siqish, bo'lish) va pptx yaratish
  db/                PostgreSQL ulanish va migratsiyalar
  storage/           Noutbukdagi fayllar
public/              Sahifalar (HTML, CSS, JS)
scripts/             start.js (tunnel bilan) va check-keys.js
test/                Avtomatik testlar
```
