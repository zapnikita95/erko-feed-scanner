import session from 'express-session';
import { createRequire } from 'module';
import {
  cleanTotp,
  dashboardLoginSession,
  hasAnySiteAccess,
} from './lib/dashboard_auth.js';
import { SESSIONS_DIR, ensureDataDirs } from './config.js';

const require = createRequire(import.meta.url);
const FileStore = require('session-file-store')(session);

const SESSION_SECRET =
  process.env.SESSION_SECRET || 'dev-only-change-me-on-railway-min-32-chars';

/** 7 суток — сессия переживает редеплой, если SESSION_SECRET стабилен и Volume на /data. */
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 1000 * 60 * 60 * 24 * 7;

/** Site ID сети ЭРКАФАРМ: вход разрешён, если в Dashboard есть доступ хотя бы к одному. */
export const ERKO_ACCESS_SITE_IDS = (
  process.env.ERKO_ACCESS_SITE_IDS || '6390,5335,292,8049'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let sessionHandler = null;

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
  if (!u.includes('@')) {
    return { ok: false, status: 400, message: 'Укажите email из личного кабинета Dashboard.' };
  }
  const code = cleanTotp(totp);
  if (code.length !== 6) {
    return { ok: false, status: 401, message: 'Введите 6-значный код из приложения-аутентификатора.' };
  }
  let cookieHeader;
  try {
    cookieHeader = await dashboardLoginSession(u, password, code);
    if (!cookieHeader) {
      return { ok: false, status: 401, message: 'Неверный логин, пароль или код TOTP.' };
    }
  } catch (e) {
    return { ok: false, status: 502, message: String(e.message || e) };
  }

  let matchedSiteId = null;
  try {
    matchedSiteId = await hasAnySiteAccess(cookieHeader, ERKO_ACCESS_SITE_IDS);
  } catch (e) {
    return { ok: false, status: 502, message: String(e.message || e) };
  }
  if (!matchedSiteId) {
    return {
      ok: false,
      status: 403,
      message:
        'Нет доступа к кабинетам Эркафарм (Озерки / Столетов / Самсон / Супераптека) в Dashboard. Попросите коллег выдать доступ к site 6390.',
    };
  }

  return { ok: true, user: u.toLowerCase(), dashboardSiteId: matchedSiteId };
}
