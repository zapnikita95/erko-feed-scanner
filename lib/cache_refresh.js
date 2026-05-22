/**
 * Фоновый прогрев / обновление кэша фидов (мастер-список + XML).
 * Озерки (6390) — первыми, остальные бренды — параллельно.
 */

const OZERKI_SITE_ID = '6390';

/** @type {null | {
 *   running: boolean;
 *   force: boolean;
 *   startedAt: number;
 *   finishedAt?: number;
 *   current?: string | null;
 *   perBrand: Array<Record<string, unknown>>;
 *   error?: string | null;
 * }} */
let cacheRefreshJob = null;

export function getCacheRefreshStatus(extra = {}) {
  if (!cacheRefreshJob) {
    return { running: false, perBrand: [], ...extra };
  }
  const { running, force, startedAt, finishedAt, current, perBrand, error, source } = cacheRefreshJob;
  const warmed = perBrand.reduce((s, b) => s + (Number(b.warmed) || 0), 0);
  const total = perBrand.reduce((s, b) => s + (Number(b.total) || 0), 0);
  const failed = perBrand.reduce((s, b) => s + (Number(b.failed) || 0), 0);
  return {
    running,
    force: Boolean(force),
    source: source || null,
    startedAt,
    finishedAt: finishedAt || null,
    current: current || null,
    perBrand,
    warmed,
    total,
    failed,
    error: error || null,
    ...extra,
  };
}

/**
 * @param {{
 *   listClients: () => Array<{ siteId: string; name: string }>;
 *   getClient: (siteId: string) => object;
 *   warmFeedsForClient: (client: object, opts: { force?: boolean; concurrency?: number }) => Promise<object>;
 *   force?: boolean;
 *   concurrency?: number;
 *   source?: 'login'|'manual';
 *   onComplete?: (result: ReturnType<typeof getCacheRefreshStatus>) => void;
 * }} deps
 */
export function scheduleNetworkCacheRefresh(deps) {
  const {
    listClients,
    getClient,
    warmFeedsForClient,
    force = true,
    concurrency = 8,
    source = 'manual',
    onComplete,
  } = deps;
  if (cacheRefreshJob?.running) return getCacheRefreshStatus();

  cacheRefreshJob = {
    running: true,
    force,
    source,
    startedAt: Date.now(),
    current: 'запуск',
    perBrand: [],
    error: null,
  };

  (async () => {
    try {
      const all = listClients();
      const ozerki = all.find((c) => String(c.siteId) === OZERKI_SITE_ID);
      const rest = all.filter((c) => String(c.siteId) !== OZERKI_SITE_ID);

      if (ozerki) {
        cacheRefreshJob.current = ozerki.name;
        const r = await warmFeedsForClient(getClient(ozerki.siteId), { force, concurrency });
        cacheRefreshJob.perBrand.push(r);
      }

      if (rest.length) {
        cacheRefreshJob.current = `остальные (${rest.length})`;
        const parallel = await Promise.all(
          rest.map(async (c) => {
            cacheRefreshJob.current = c.name;
            return warmFeedsForClient(getClient(c.siteId), { force, concurrency });
          }),
        );
        cacheRefreshJob.perBrand.push(...parallel);
      }
    } catch (e) {
      cacheRefreshJob.error = String(e.message || e);
    } finally {
      cacheRefreshJob.running = false;
      cacheRefreshJob.finishedAt = Date.now();
      cacheRefreshJob.current = null;
      const snapshot = getCacheRefreshStatus();
      const warmed = snapshot.warmed || 0;
      if (!snapshot.error && warmed > 0 && typeof onComplete === 'function') {
        try {
          onComplete(snapshot);
        } catch (e) {
          console.warn('[cache_refresh] onComplete failed:', e.message || e);
        }
      }
    }
  })();

  return getCacheRefreshStatus();
}
