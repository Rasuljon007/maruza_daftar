// Shared helpers: API calls, auth guard, theme, toasts, formatting.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** fetch() wrapper: JSON in/out, Uzbek error messages, redirect to login on 401. */
export async function api(path, { method = 'GET', json, body, headers = {}, redirectOn401 = true } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    throw new ApiError(0, "Serverga ulanib bo'lmadi. Internetni tekshiring yoki noutbuk serveri yoqilganiga ishonch hosil qiling.");
  }
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && redirectOn401) {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    const msg = data?.error || (res.status === 502 || res.status === 530
      ? "Server javob bermayapti. Noutbukda server ishlayotganini tekshiring."
      : `Xato yuz berdi (${res.status}). Qayta urinib ko'ring.`);
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

/** Ensures the user is logged in; returns the user. */
export async function requireUser() {
  const { user } = await api('/api/auth/me');
  if (!user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {}); // page is navigating away; stop here quietly
  }
  return user;
}

let toastTimer;
export function toast(message, { error = false, ms = 3500 } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "19-oktabr 2026, 20:26" (browsers format uz-UZ inconsistently, so it is done by hand). */
export function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}-${MONTHS_UZ[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const STATUS_LABELS = {
  recording: 'Yozilmoqda',
  queued: 'Navbatda',
  transcribing: 'Matnga aylantirilmoqda',
  analyzing: 'AI tahlil qilmoqda',
  ready: 'Tayyor',
  failed: 'Xato',
};

export function statusClass(status) {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'busy';
}

/** Tiny element builder: h('div', { class: 'x', onclick }, child, 'text') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// --- theme ---
const THEME_KEY = 'md-theme';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  /* storage blocked */
}

export function initTopbar() {
  const btn = document.querySelector('[data-theme-toggle]');
  btn?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  });
}
