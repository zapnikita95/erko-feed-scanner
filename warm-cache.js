// Прогрев кэша XML по списку фидов партнёра.
//   node warm-cache.js [siteId] [фильтр-подстрока]
// Примеры:
//   node warm-cache.js 330 москва
//   node warm-cache.js 6390 region_14
//   node warm-cache.js 6390

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { getClient, defaultSiteId } from './clients.js';
import { CACHE_ROOT, ensureDataDirs } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureDataDirs();

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 anyquery-feed-scanner' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

function cacheDir(siteId) {
  const dir = path.join(CACHE_ROOT, String(siteId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const cachePath = (siteId, u) => path.join(cacheDir(siteId), md5(u) + '.xml.gz');

async function download(siteId, url) {
  const text = await fetchText(url);
  fs.writeFileSync(cachePath(siteId, url), zlib.gzipSync(Buffer.from(text, 'utf8')));
  return text.length;
}

const a2 = process.argv[2] || '';
const a3 = process.argv[3] || '';
let siteId = defaultSiteId();
let filter = '';
if (/^\d+$/.test(a2)) {
  siteId = a2;
  filter = a3;
} else {
  filter = a2;
}
filter = filter.toLowerCase();

const client = getClient(siteId);
const meta = JSON.parse(await fetchText(client.feedsListUrl));
let feeds = meta.feedUrls;
if (filter) {
  feeds = feeds.filter(f => {
    const t = (f.title || '').toLowerCase();
    const eid = String(f.externalId || '').toLowerCase();
    return eid === filter || eid.startsWith(filter) || t.includes(filter);
  });
}
console.log(`[site ${siteId} ${client.name}] Warming ${feeds.length} feeds...`);

let idx = 0, ok = 0, fail = 0, bytes = 0;
const started = Date.now();
async function worker() {
  while (true) {
    const i = idx++;
    if (i >= feeds.length) return;
    try {
      const sz = await download(siteId, feeds[i].url);
      bytes += sz;
      ok++;
      if (ok % 50 === 0) console.log(`  ${ok}/${feeds.length}`);
    } catch (e) {
      fail++;
      console.warn(`  FAIL ${feeds[i].externalId}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`Done: ok=${ok}, fail=${fail}, time=${Date.now() - started}ms, ~${(bytes / 1024 / 1024).toFixed(1)} MiB`);
