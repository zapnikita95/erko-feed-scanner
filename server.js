// ЭРКАФАРМ — Feed Scanner: поиск товара по YML-фидам аптек сети.

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { addLocalClient, defaultSiteId, getClient, listClients } from './clients.js';
import { CACHE_ROOT, DATA_DIR, ensureDataDirs, getStorageStats } from './config.js';
import {
  getCacheRefreshStatus,
  scheduleNetworkCacheRefresh,
} from './lib/cache_refresh.js';
import {
  canStartRefresh,
  getRefreshQuota,
  recordRefresh,
} from './lib/cache_refresh_quota.js';
import {
  currentUser,
  requireUser,
  requireUserPage,
  sessionMiddleware,
  tryLogin,
} from './auth.js';

function mapSearchResult(r) {
  return {
    externalId: r.feed.externalId,
    title: r.feed.title,
    feedUrl: r.feed.url,
    kind: r.feed.kind,
    city: r.feed.city,
    total: r.total,
    error: r.error,
    matches: r.matches,
  };
}

async function loadAllNetworkFeeds() {
  const brands = [];
  for (const c of listClients()) {
    const client = getClient(c.siteId);
    const meta = await loadFeedsMeta(client);
    const feeds = enrichFeeds(meta, client).map(f => ({
      ...f,
      siteId: client.siteId,
      clientName: client.name,
    }));
    brands.push({ siteId: client.siteId, name: client.name, feeds });
  }
  return brands;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureDataDirs();
const storageBoot = getStorageStats();
console.log(
  `[erkapharm-feed] storage dataDir=${storageBoot.dataDir} partners=${storageBoot.partners} cacheXml=${storageBoot.cacheFiles} writable=${storageBoot.volumeWritable}`,
);
const FEEDS_TTL_MS = 1000 * 60 * 60 * 12;
const META_TTL_MS = 1000 * 60 * 60 * 24;
const PORT = Number(process.env.PORT) || 4173;
/** Таймаут загрузки одного URL (мс). Без него «зависший» CDN блокирует воркеры бесконечно. */
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 120_000;

function cacheDirForSite(siteId) {
  const dir = path.join(CACHE_ROOT, String(siteId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 anyquery-feed-scanner',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`Timeout ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function cachePath(siteId, url) {
  return path.join(cacheDirForSite(siteId), md5(url) + '.xml.gz');
}

async function getCachedFeedXml(siteId, url, { maxAgeMs = FEEDS_TTL_MS, force = false } = {}) {
  const file = cachePath(siteId, url);
  try {
    const st = fs.statSync(file);
    if (!force && Date.now() - st.mtimeMs < maxAgeMs) {
      return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    }
  } catch {}
  const text = await fetchText(url);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(text, 'utf8')));
  return text;
}

function enrichFeeds(meta, client) {
  return meta.feedUrls.map(f => {
    const c = client.classify(f);
    return { ...f, kind: c.kind, city: c.city };
  });
}

async function loadFeedsMeta(client, { force = false } = {}) {
  const dir = cacheDirForSite(client.siteId);
  const metaFile = path.join(dir, client.metaCacheName);
  try {
    const st = fs.statSync(metaFile);
    if (!force && Date.now() - st.mtimeMs < META_TTL_MS) {
      return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    }
  } catch {}
  const text = await fetchText(client.feedsListUrl);
  const json = JSON.parse(text);
  fs.writeFileSync(metaFile, JSON.stringify(json));
  return json;
}

function validateFeedsMeta(json) {
  if (!json || !Array.isArray(json.feedUrls)) {
    throw new Error('Мастер-фид должен быть JSON с массивом feedUrls.');
  }
  if (!json.feedUrls.length) throw new Error('В master feed нет ни одного фида.');
  const bad = json.feedUrls.find(
    f => !f || !f.url || f.externalId == null || !f.title,
  );
  if (bad) {
    throw new Error('Каждый фид должен содержать url, externalId и title.');
  }
}

function findCityWideForCityName(allFeeds, cityName) {
  if (!cityName) return null;
  const cityLower = String(cityName).toLowerCase();
  return allFeeds.find(
    f => f.kind === 'city' && f.title.toLowerCase().includes(cityLower),
  );
}

function feedsForCityAndKinds(allFeeds, city, kinds, { defaultWhenKindsEmpty } = {}) {
  const fallback = defaultWhenKindsEmpty ?? ['store', 'city', 'global'];
  const kindsArr = Array.isArray(kinds) && kinds.length ? kinds : fallback;
  const out = [];
  const seen = new Set();
  if (kindsArr.includes('store')) {
    for (const f of allFeeds) {
      if (f.kind === 'store' && f.city === city && !seen.has(f.externalId)) {
        seen.add(f.externalId);
        out.push(f);
      }
    }
  }
  if (kindsArr.includes('city')) {
    const cw = findCityWideForCityName(allFeeds, city);
    if (cw && !seen.has(cw.externalId)) {
      seen.add(cw.externalId);
      out.unshift(cw);
    }
  }
  if (kindsArr.includes('global')) {
    const g = allFeeds.find(f => f.kind === 'global');
    if (g && !seen.has(g.externalId)) {
      seen.add(g.externalId);
      out.push(g);
    }
  }
  return out;
}

const OFFER_RE = /<offer\b([^>]*)>([\s\S]*?)<\/offer>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;
const TAG_RE = /<(\w+)>([\s\S]*?)<\/\1>/g;

function parseOffers(xml) {
  const offers = [];
  let m;
  OFFER_RE.lastIndex = 0;
  while ((m = OFFER_RE.exec(xml)) !== null) {
    const attrs = {};
    let a;
    const attrStr = m[1];
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(attrStr)) !== null) attrs[a[1]] = a[2];
    const body = m[2];
    const fields = {};
    let t;
    TAG_RE.lastIndex = 0;
    while ((t = TAG_RE.exec(body)) !== null) {
      if (fields[t[1]] === undefined) fields[t[1]] = t[2];
    }
    const url = fields.url || '';
    const slug = slugFromUrl(url);
    offers.push({
      id: attrs.id || '',
      available: attrs.available !== 'false',
      price: fields.price || '',
      oldprice: fields.oldprice || '',
      url,
      slug,
    });
  }
  return offers;
}

function slugFromUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  try {
    const u = new URL(raw);
    const segs = u.pathname.split('/').filter(Boolean);
    return segs[segs.length - 1] || '';
  } catch {
    const path = raw.split('?')[0].split('#')[0];
    const segs = path.split('/').filter(Boolean);
    return segs[segs.length - 1] || '';
  }
}

const offerCache = new Map(); // `${siteId}:${externalId}` -> { offers, fileMtime }

function offerCacheKey(siteId, externalId) {
  return `${siteId}:${externalId}`;
}

async function getOffers(siteId, feed, { force = false } = {}) {
  const key = offerCacheKey(siteId, feed.externalId);
  const cached = offerCache.get(key);
  const xml = await getCachedFeedXml(siteId, feed.url, { force });
  const file = cachePath(siteId, feed.url);
  const st = fs.statSync(file);
  if (!force && cached && cached.fileMtime === st.mtimeMs) return cached.offers;
  const offers = parseOffers(xml);
  offerCache.set(key, { offers, fileMtime: st.mtimeMs });
  return offers;
}

function normalizeQuery(q) {
  const raw = String(q || '').trim();
  if (!raw) return { kind: 'empty', value: '' };
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const segs = u.pathname.split('/').filter(Boolean);
      return { kind: 'slug', value: (segs[segs.length - 1] || '').toLowerCase(), raw };
    } catch {}
  }
  if (/^\d+$/.test(raw)) return { kind: 'id', value: raw };
  return { kind: 'substring', value: raw.toLowerCase() };
}

function matchOffer(offer, q) {
  if (q.kind === 'id') return offer.id === q.value;
  if (q.kind === 'slug') return offer.slug.toLowerCase() === q.value;
  if (q.kind === 'substring') {
    return (
      offer.slug.toLowerCase().includes(q.value) ||
      offer.url.toLowerCase().includes(q.value)
    );
  }
  return false;
}

async function searchInFeed(siteId, feed, q) {
  try {
    const offers = await getOffers(siteId, feed);
    const matches = offers.filter(o => matchOffer(o, q));
    return { feed, matches, total: offers.length };
  } catch (err) {
    return { feed, error: String(err.message || err), matches: [], total: 0 };
  }
}

async function warmFeedsForClient(client, { force = false, concurrency = 8 } = {}) {
  const meta = await loadFeedsMeta(client, { force });
  const feeds = enrichFeeds(meta, client);
  let ok = 0;
  let fail = 0;
  let idx = 0;
  const workers = Math.min(Math.max(1, Number(concurrency) || 8), 16, feeds.length || 1);
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= feeds.length) return;
      try {
        await getCachedFeedXml(client.siteId, feeds[i].url, { force });
        ok++;
      } catch {
        fail++;
      }
    }
  }
  if (feeds.length) await Promise.all(Array.from({ length: workers }, worker));
  return {
    siteId: client.siteId,
    name: client.name,
    total: feeds.length,
    warmed: ok,
    failed: fail,
    metaRefreshed: Boolean(force),
  };
}

function startNetworkCacheRefresh({ force = true, concurrency = 8, source = 'manual' } = {}) {
  const gate = canStartRefresh(source);
  if (!gate.allowed) {
    return {
      started: false,
      skipped: true,
      reason: gate.reason,
      message: gate.message,
      quota: gate.quota,
      ...getCacheRefreshStatus({ quota: gate.quota }),
    };
  }

  const status = scheduleNetworkCacheRefresh({
    listClients,
    getClient,
    warmFeedsForClient,
    force,
    concurrency,
    source,
    onComplete: () => recordRefresh(source),
  });
  return { started: true, skipped: false, quota: gate.quota, ...status };
}

async function runSearch(siteId, feeds, q, { concurrency = 16 } = {}) {
  const results = new Array(feeds.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= feeds.length) return;
      results[i] = await searchInFeed(siteId, feeds[i], q);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, feeds.length) }, worker);
  await Promise.all(workers);
  return results;
}

function parseSiteId(req) {
  const q = req.query?.siteId ?? req.body?.siteId;
  return q != null && q !== '' ? String(q) : defaultSiteId();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware());

const publicDir = path.join(__dirname, 'public');

app.get('/api/health', (req, res) => {
  const storage = getStorageStats();
  res.json({
    ok: true,
    app: 'erko-feed-scanner',
    canAddClients: true,
    dataDir: DATA_DIR,
    storage,
    authenticated: Boolean(currentUser(req)),
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, totp } = req.body || {};
  const result = await tryLogin(username, password, totp);
  if (!result.ok) {
    return res.status(result.status || 401).json({ error: result.message });
  }
  req.session.user = result.user;
  req.session.save((err) => {
    if (err) console.warn('[auth] session save failed:', err.message || err);
    const refresh = startNetworkCacheRefresh({ force: true, source: 'login' });
    res.json({
      ok: true,
      user: result.user,
      cacheRefreshStarted: Boolean(refresh.started),
      cacheRefreshSkipped: Boolean(refresh.skipped),
      cacheRefresh: refresh,
    });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});
app.get('/totp_modal.js', (_req, res) => {
  res.sendFile(path.join(publicDir, 'totp_modal.js'));
});
app.get('/favicon.svg', (_req, res) => {
  res.sendFile(path.join(publicDir, 'favicon.svg'));
});

app.get('/', requireUserPage, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(requireUser);
app.use(express.static(publicDir, { index: false }));

app.get('/api/clients', (req, res) => {
  res.json({ clients: listClients() });
});

app.get('/api/cache/refresh/status', (req, res) => {
  res.json(getCacheRefreshStatus({ quota: getRefreshQuota() }));
});

app.post('/api/cache/refresh', (req, res) => {
  const { concurrency = 8, force = true } = req.body || {};
  if (getCacheRefreshStatus().running) {
    return res.status(409).json({
      error: 'Обновление кэша уже выполняется.',
      ...getCacheRefreshStatus({ quota: getRefreshQuota() }),
    });
  }
  const refresh = startNetworkCacheRefresh({
    force: force !== false,
    concurrency,
    source: 'manual',
  });
  if (refresh.skipped) {
    return res.status(429).json({
      error: refresh.message,
      reason: refresh.reason,
      ...refresh,
    });
  }
  res.json({ ok: true, ...refresh });
});

app.post('/api/clients', async (req, res) => {
  try {
    const started = Date.now();
    const { name, siteId, feedsListUrl } = req.body || {};
    const candidate = {
      siteId: String(siteId || '').trim(),
      name: String(name || '').trim(),
      feedsListUrl: String(feedsListUrl || '').trim(),
      metaCacheName: 'feeds_list.json',
      classify: f => ({ kind: 'store', city: null, ...f }),
    };

    const masterText = await fetchText(candidate.feedsListUrl);
    const meta = JSON.parse(masterText);
    validateFeedsMeta(meta);

    const client = addLocalClient({ siteId, name, feedsListUrl });
    const enriched = enrichFeeds(meta, client);
    const dir = cacheDirForSite(client.siteId);
    fs.writeFileSync(path.join(dir, client.metaCacheName), JSON.stringify(meta));

    const sampleFeeds = enriched.slice(0, Math.min(3, enriched.length));
    let sampleOk = 0;
    const sampleErrors = [];
    for (const feed of sampleFeeds) {
      try {
        const xml = await getCachedFeedXml(client.siteId, feed.url, { force: true });
        parseOffers(xml);
        sampleOk++;
      } catch (e) {
        sampleErrors.push(`${feed.externalId}: ${e.message || e}`);
      }
    }

    const byKind = enriched.reduce((acc, f) => {
      acc[f.kind] = (acc[f.kind] || 0) + 1;
      return acc;
    }, {});
    res.json({
      ok: true,
      elapsedMs: Date.now() - started,
      client: { siteId: client.siteId, name: client.name, feedsListUrl: client.feedsListUrl },
      feedsCount: enriched.length,
      byKind,
      preprocessed: { checked: sampleFeeds.length, ok: sampleOk, errors: sampleErrors },
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/feeds', async (req, res) => {
  try {
    const client = getClient(parseSiteId(req));
    const meta = await loadFeedsMeta(client, { force: req.query.force === '1' });
    const feeds = enrichFeeds(meta, client);
    const byCity = new Map();
    for (const f of feeds) {
      if (!f.city) continue;
      byCity.set(f.city, (byCity.get(f.city) || 0) + (f.kind === 'store' ? 1 : 0));
    }
    const cities = [...byCity.entries()]
      .map(([name, storeCount]) => ({ name, storeCount }))
      .sort((a, b) => b.storeCount - a.storeCount);
    res.json({
      siteId: client.siteId,
      clientName: client.name,
      feedsListUrl: client.feedsListUrl,
      feeds,
      cities,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/feed-status', (req, res) => {
  try {
    const client = getClient(parseSiteId(req));
    const dir = cacheDirForSite(client.siteId);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.xml.gz')) : [];
    res.json({ siteId: client.siteId, cachedCount: files.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const client = getClient(parseSiteId(req));
    const siteId = client.siteId;
    const { query, feedIds, city, kinds } = req.body || {};
    const q = normalizeQuery(query);
    if (q.kind === 'empty') return res.status(400).json({ error: 'Empty query' });

    const meta = await loadFeedsMeta(client);
    let feeds = enrichFeeds(meta, client);
    if (Array.isArray(feedIds) && feedIds.length) {
      const set = new Set(feedIds);
      feeds = feeds.filter(f => set.has(f.externalId));
    } else if (city) {
      feeds = feedsForCityAndKinds(feeds, city, kinds, { defaultWhenKindsEmpty: ['store', 'city', 'global'] });
    } else if (Array.isArray(kinds) && kinds.length) {
      feeds = feeds.filter(f => kinds.includes(f.kind));
    }

    const allFeeds = feeds;
    const started = Date.now();
    let results = await runSearch(siteId, feeds, q);
    let globalAutoScanned = false;
    let note;
    const hitsBefore = results.filter(r => r.matches.length);
    if (!hitsBefore.length && q.kind !== 'id') {
      const globalFeed = enrichFeeds(meta, client).find(f => f.kind === 'global');
      const hadGlobal = feeds.some(f => f.kind === 'global');
      if (globalFeed && !hadGlobal) {
        const globalResult = await searchInFeed(siteId, globalFeed, q);
        globalAutoScanned = true;
        if (globalResult.matches.length) {
          results = [...results, globalResult];
          note =
            'Товар найден в global-фиде. В точечных фидах часто есть только offer id без URL — для поиска по slug включайте «global» или ищите по id.';
        }
      }
    }
    const elapsedMs = Date.now() - started;
    const hits = results.filter(r => r.matches.length);
    res.json({
      siteId,
      query: q,
      feedsScanned: feeds.length + (globalAutoScanned ? 1 : 0),
      elapsedMs,
      hitsCount: hits.length,
      note,
      globalAutoScanned,
      results: results.map(mapSearchResult),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/network-summary', async (_req, res) => {
  try {
    const brands = [];
    let totalFeeds = 0;
    let totalCached = 0;
    for (const c of listClients()) {
      const client = getClient(c.siteId);
      const meta = await loadFeedsMeta(client);
      const feeds = enrichFeeds(meta, client);
      const dir = cacheDirForSite(client.siteId);
      const cached = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => f.endsWith('.xml.gz')).length
        : 0;
      totalFeeds += feeds.length;
      totalCached += cached;
      brands.push({
        siteId: client.siteId,
        name: client.name,
        feedsCount: feeds.length,
        cachedCount: cached,
      });
    }
    res.json({ brands, totalFeeds, totalCached });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/search-all', async (req, res) => {
  try {
    const { query, concurrency = 12 } = req.body || {};
    const q = normalizeQuery(query);
    if (q.kind === 'empty') return res.status(400).json({ error: 'Empty query' });

    const started = Date.now();
    const brandBlocks = await loadAllNetworkFeeds();
    const brandsOut = [];
    let feedsScanned = 0;
    let hitsCount = 0;

    for (const block of brandBlocks) {
      let results = await runSearch(block.siteId, block.feeds, q, { concurrency });
      if (!results.some(r => r.matches.length) && q.kind !== 'id') {
        const globalFeed = block.feeds.find(f => f.kind === 'global');
        if (globalFeed) {
          const globalResult = await searchInFeed(block.siteId, globalFeed, q);
          if (globalResult.matches.length) results = [...results, globalResult];
        }
      }
      feedsScanned += block.feeds.length;
      const hits = results.filter(r => r.matches.length);
      hitsCount += hits.length;
      if (hits.length) {
        brandsOut.push({
          siteId: block.siteId,
          name: block.name,
          hitsCount: hits.length,
          results: hits.map(r => ({ ...mapSearchResult(r), siteId: block.siteId, clientName: block.name })),
        });
      }
    }

    brandsOut.sort((a, b) => b.hitsCount - a.hitsCount);
    res.json({
      query: q,
      brandsScanned: brandBlocks.length,
      feedsScanned,
      hitsCount,
      elapsedMs: Date.now() - started,
      brands: brandsOut,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/warm-all', async (req, res) => {
  try {
    const { concurrency = 8, force = false } = req.body || {};
    if (force === true) {
      const gate = canStartRefresh('manual');
      if (!gate.allowed) {
        return res.status(429).json({
          error: gate.message,
          reason: gate.reason,
          quota: gate.quota,
        });
      }
    }
    const started = Date.now();
    const perBrand = [];
    let total = 0;
    let warmed = 0;
    let failed = 0;

    for (const c of listClients()) {
      const r = await warmFeedsForClient(getClient(c.siteId), {
        force: force === true,
        concurrency,
      });
      perBrand.push(r);
      total += r.total;
      warmed += r.warmed;
      failed += r.failed;
    }

    if (force === true && warmed > 0) {
      recordRefresh('manual');
    }

    res.json({
      elapsedMs: Date.now() - started,
      brands: perBrand.length,
      total,
      warmed,
      failed,
      perBrand,
      force: force === true,
      quota: getRefreshQuota(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/warm', async (req, res) => {
  try {
    const client = getClient(parseSiteId(req));
    const { feedIds, city, kinds, warmAll, concurrency = 8, force = false } = req.body || {};
    const meta = await loadFeedsMeta(client, { force: force === true });
    let feeds = enrichFeeds(meta, client);
    if (Array.isArray(feedIds) && feedIds.length) {
      const set = new Set(feedIds);
      feeds = feeds.filter(f => set.has(f.externalId));
    } else if (city) {
      feeds = feedsForCityAndKinds(feeds, city, kinds, { defaultWhenKindsEmpty: ['store'] });
    } else if (warmAll === true) {
      // все фиды партнёра
    } else {
      return res.status(400).json({
        error:
          'Выберите город, отметьте фиды — или включите галочку «прогреть все фиды» в UI.',
      });
    }
    if (!feeds.length) {
      return res.status(400).json({ error: 'Нет фидов для прогрева по текущим условиям.' });
    }
    const started = Date.now();
    let ok = 0;
    let fail = 0;
    let idx = 0;
    const workers = Math.min(Math.max(1, Number(concurrency) || 8), 16, feeds.length);
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= feeds.length) return;
        try {
          await getCachedFeedXml(client.siteId, feeds[i].url, { force: force === true });
          ok++;
        } catch {
          fail++;
        }
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
    res.json({
      siteId: client.siteId,
      warmed: ok,
      failed: fail,
      elapsedMs: Date.now() - started,
      total: feeds.length,
      force: force === true,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[erko-feed-scanner] http://localhost:${PORT}  data=${DATA_DIR}`);
});
