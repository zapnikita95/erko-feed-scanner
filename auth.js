import session from 'express-session';
import { dashboardLogin, cleanTotp } from './lib/dashboard_auth.js';

const SESSION_SECRET =
  process.env.SESSION_SECRET || 'dev-only-change-me-on-railway-min-32-chars';

const ALLOWED_SUFFIXES = (process.env.ALLOWED_EMAIL_SUFFIXES || '@diginetica.com,@anyquery.ru')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function emailAllowed(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u.includes('@')) return false;
  return ALLOWED_SUFFIXES.some((s) => u.endsWith(s));
}

export function sessionMiddleware() {
  return session({
    name: 'erko_feed_scanner_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12,
    },
  });
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
  const ok = await dashboardLogin(u, password, code);
  if (!ok) {
    return { ok: false, status: 401, message: 'Неверный логин, пароль или код TOTP.' };
  }
  return { ok: true, user: u.toLowerCase() };
}
