// Starts the app and, unless APP_URL is set, a free Cloudflare quick tunnel so the
// site is reachable over HTTPS from a phone. Usage: npm start
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';
import { startServer } from '../src/server.js';
import { broadcastSiteUrl } from '../src/bot/index.js';

function startTunnel(port) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(config.cloudflaredPath, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
        windowsHide: true,
      });
    } catch (err) {
      resolve({ child: null, error: err });
      return;
    }
    let found = false;
    const onData = (d) => {
      const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !found) {
        found = true;
        resolve({ child, url: m[0] });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!found) resolve({ child: null, error: err });
    });
    child.on('exit', (code) => {
      if (!found) resolve({ child: null, error: new Error(`cloudflared exited with code ${code}`) });
      else console.error(`\n⚠️  Tunnel to'xtadi (kod ${code}). Telefondan kirish ishlamaydi. Serverni qayta ishga tushiring: npm start\n`);
    });
    setTimeout(() => {
      if (!found) resolve({ child, error: new Error('Tunnel manzili 60 soniyada paydo bo\'lmadi') });
    }, 60_000);
  });
}

/**
 * Windows: keeps the laptop from going to sleep while the server runs (the screen may
 * still turn off). A small PowerShell helper holds the "system required" flag and exits
 * by itself once this process is gone. Disable with KEEP_AWAKE=false.
 */
function keepAwake() {
  if (process.platform !== 'win32' || process.env.KEEP_AWAKE === 'false') return null;
  const script = `
Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
  [W.P]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
  Start-Sleep -Seconds 30
}`;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => console.warn(`[uyqu] Uyquni o'chirib bo'lmadi: ${err.message}`));
    console.log("[uyqu] Server ishlayotganda noutbuk uxlab qolmaydi (qopqoqni yopmang).");
    return child;
  } catch (err) {
    console.warn(`[uyqu] Uyquni o'chirib bo'lmadi: ${err.message}`);
    return null;
  }
}

async function main() {
  const { shutdown } = await startServer();
  const awake = keepAwake();
  let tunnel = null;

  if (config.appUrl) {
    console.log(`\n✅ Sayt: ${config.appUrl}\n`);
  } else {
    console.log('[tunnel] Cloudflare tunnel ochilmoqda…');
    const res = await startTunnel(config.port);
    tunnel = res.child;
    if (res.url) {
      config.appUrl = res.url;
      console.log(`\n✅ Sayt tayyor: ${res.url}\n   Telefoningizda shu manzilni oching (bot ham /sayt buyrug'ida yuboradi).\n`);
      await broadcastSiteUrl().catch((err) => console.warn('[bot] broadcast failed:', err.message));
    } else {
      console.warn(
        `\n⚠️  Tunnel ochilmadi: ${res.error?.message}\n` +
          '   cloudflared o\'rnatilganini tekshiring (PowerShell: cloudflared --version).\n' +
          `   Hozircha sayt faqat shu kompyuterda ochiladi: http://localhost:${config.port}\n`,
      );
    }
  }

  const stop = async () => {
    tunnel?.kill();
    awake?.kill();
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(`\n❌ Server ishga tushmadi:\n${err.message}\n`);
  process.exit(1);
});
