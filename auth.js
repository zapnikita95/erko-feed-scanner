import session from 'express-session';
import { createRequire } from 'module';
import { dashboardLogin, cleanTotp } from './lib/dashboard_auth.js';
import { SESSIONS_DIR, ensureDataDirs } from './config.js';

const require = createRequire(import.meta.url);
const FileStore = require('session-file-store')(session);

const SESSION_SECRET =
  process.env.SESSION_SECRET || 'dev-only-change-me-on-railway-min-32-chars';

/** 7 суток — сессия переживает редеплой, если SESSION_SECRET стабилен и Volume на /data. */
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 1000 * 60 * 60 * 24 * 7;

const ALLOWED_SUFFIXES = (process.env.ALLOWED_EMAIL_SUFFIXES || '@diginetica.com,@anyquery.ru,@tbank.ru')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

let sessionHandler = null;

export function emailAllowed(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u.includes('@')) return false;
  return ALLOWED_SUFFIXES.some((s) => u.endsWith(s));
}

export function sessionMiddleware() {
  if (sessionHandler) return sessionHandler;
  ensureDataDirs();
  sessionHandler = session({
    name: 'erko_feed_scanner_sid',
    secret: SESSION_SECRET,
    store: new FileStore({
      path: SESSIONS_DIR,
      ttl: Math.ceil(SESSION_MAX_AGE_MS / 1000),
      retries: 0,
      logFn: () => {},
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
  return sessionHandler;
}

export function currentUser(req) {
  return req.session?.user || null;
}

export function requireUser(req, res, next) {
  if (currentUser(req)) return next();
  return res.status(401).json({ error: 'auth_required', message: 'Требуется вход через Dashboard' });
}

export function requireUserPage(req, res, next) {
  if (currentUser(req)) return next();
  return res.redirect('/login.html');
}

export async function tryLogin(username, password, totp) {
  const u = String(username || '').trim();
  if (!emailAllowed(u)) {
    return { ok: false, status: 403, message: 'Доступ только для корпоративных учётных записей.' };
  }
  const code = cleanTotp(totp);
  if (code.length !== 6) {
    return { ok: false, status: 401, message: 'Введите 6-значный код из приложения-аутентификатора.' };
  }
  try {
    const ok = await dashboardLogin(u, password, code);
    if (!ok) {
      return { ok: false, status: 401, message: 'Неверный логин, пароль или код TOTP.' };
    }
  } catch (e) {
    return { ok: false, status: 502, message: String(e.message || e) };
  }
  return { ok: true, user: u.toLowerCase() };
}
