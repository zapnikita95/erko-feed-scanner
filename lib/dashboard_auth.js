const DASHBOARD_HOST = 'https://dashboard-api.diginetica.net';

export function cleanTotp(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 6);
}

function collectSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  if (!raw) return [];
  return String(raw).split(/,(?=[^;]+?=)/);
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies
    .map((line) => String(line).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/** @deprecated use dashboardLoginSession + hasSiteAccess */
export async function dashboardLogin(username, password, totp) {
  const session = await dashboardLoginSession(username, password, totp);
  return Boolean(session);
}

/**
 * Логин в Dashboard API. Возвращает Cookie-строку для последующих запросов или null.
 */
export async function dashboardLoginSession(username, password, totp) {
  const form = new URLSearchParams();
  form.set('username', String(username || '').trim());
  form.set('password', String(password || ''));
  form.set('totp', cleanTotp(totp));
  try {
    const res = await fetch(`${DASHBOARD_HOST}/login`, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (res.status !== 202 && !res.ok) return null;
    const cookies = collectSetCookies(res);
    const header = cookieHeaderFromSetCookies(cookies);
    return header || null;
  } catch (e) {
    throw new Error(`Dashboard недоступен: ${e.message || e}`);
  }
}

/**
 * Есть ли у сессии доступ к siteId в Dashboard (пробуем лёгкий GET фидов).
 */
export async function hasSiteAccess(cookieHeader, siteId) {
  if (!cookieHeader) return false;
  const sid = String(siteId || '').trim();
  if (!sid) return false;
  const paths = [
    `/site/${sid}/feeds?feedType=YML`,
    `/api/feeds?siteId=${encodeURIComponent(sid)}`,
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${DASHBOARD_HOST}${path}`, {
        headers: { Accept: 'application/json', Cookie: cookieHeader },
      });
      if (res.status === 200) return true;
      if (res.status === 401 || res.status === 403) continue;
    } catch {
      /* try next path */
    }
  }
  return false;
}

export async function hasAnySiteAccess(cookieHeader, siteIds) {
  for (const siteId of siteIds) {
    if (await hasSiteAccess(cookieHeader, siteId)) return siteId;
  }
  return null;
}
