const DASHBOARD_HOST = 'https://dashboard-api.diginetica.net';

export function cleanTotp(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 6);
}

export async function dashboardLogin(username, password, totp) {
  const form = new URLSearchParams();
  form.set('username', String(username || '').trim());
  form.set('password', String(password || ''));
  form.set('totp', cleanTotp(totp));
  const res = await fetch(`${DASHBOARD_HOST}/login`, {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
  });
  return res.status === 202 || res.ok;
}
