import { api, toast, initTopbar } from './common.js';

const $ = (id) => document.getElementById(id);
initTopbar();

const next = new URLSearchParams(location.search).get('next');
const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

const { user } = await api('/api/auth/me', { redirectOn401: false });
if (user) location.replace(target);

let pollTimer = null;

async function poll({ quiet = false } = {}) {
  try {
    const r = await api('/api/auth/poll', { redirectOn401: false });
    if (r.loggedIn) {
      clearInterval(pollTimer);
      location.replace(target);
    } else if (r.expired && !quiet) {
      clearInterval(pollTimer);
      $('waiting').classList.add('hidden');
      $('loginBtn').disabled = false;
      toast("Kirish havolasi muddati tugadi. Tugmani qayta bosing.", { error: true });
    }
  } catch {
    /* keep polling */
  }
}

$('loginBtn').addEventListener('click', async () => {
  $('loginBtn').disabled = true;
  try {
    const { botUrl } = await api('/api/auth/start', { method: 'POST', redirectOn401: false });
    $('botLink').href = botUrl;
    $('waiting').classList.remove('hidden');
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 2000);
    const win = window.open(botUrl, '_blank');
    if (!win) location.href = botUrl;
  } catch (err) {
    $('loginBtn').disabled = false;
    toast(err.message, { error: true });
  }
});

// If the page was reloaded after confirming in Telegram, finish the login.
poll({ quiet: true });

// Coming back from Telegram: check immediately.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pollTimer) poll();
});
