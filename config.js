import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Персистентные данные: Railway Volume → /data */
function resolveDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  const onRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID,
  );
  if (onRailway && isWritableDir('/data')) return '/data';
  return path.join(__dirname, 'data');
}

export const DATA_DIR = resolveDataDir();
export const CACHE_ROOT = path.join(DATA_DIR, 'cache');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const CACHE_REFRESH_LOG_FILE = path.join(DATA_DIR, 'cache_refresh_daily.json');
export const CLIENTS_FILE = path.join(DATA_DIR, 'clients.local.json');
export const LEGACY_CACHE_ROOT = path.join(__dirname, 'cache');
export const BUNDLED_CLIENTS_FILE = path.join(__dirname, 'data', 'clients.local.json');
export const LEGACY_DATA_CACHE = path.join(__dirname, 'data', 'cache');

/** Партнёры сети ЭРКАФАРМ (без amwine и прочих «онлайн» проектов). */
export const ERKO_DEFAULT_CLIENTS = [
  {
    siteId: '6390',
    name: 'Озерки',
    feedsListUrl: 'https://superapteka.ru/export/ecom/ozerki/anyquery/feeds_list.json',
  },
  {
    siteId: '5335',
    name: 'Столетов',
    feedsListUrl: 'https://superapteka.ru/export/ecom/stoletov/anyquery/feeds_list.json',
  },
  {
    siteId: '292',
    name: 'Самсон Фарма',
    feedsListUrl: 'https://superapteka.ru/export/ecom/samson/anyquery/feeds_list.json',
  },
];

export function ensureDataDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function copyDirIfMissing(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.existsSync(to)) continue;
    fs.cpSync(from, to, { recursive: true });
    n++;
  }
  return n;
}

/** Первый запуск на Volume: подтянуть partners + cache из образа, если в /data пусто. */
export function migrateToDataDir() {
  ensureDataDirs();

  if (!fs.existsSync(CLIENTS_FILE) && fs.existsSync(BUNDLED_CLIENTS_FILE)) {
    fs.copyFileSync(BUNDLED_CLIENTS_FILE, CLIENTS_FILE);
    console.log(`[erkapharm-feed] seed clients: ${BUNDLED_CLIENTS_FILE} → ${CLIENTS_FILE}`);
  }

  const cacheEmpty = !fs.existsSync(CACHE_ROOT) || fs.readdirSync(CACHE_ROOT).length === 0;
  if (cacheEmpty) {
    const n1 = copyDirIfMissing(LEGACY_DATA_CACHE, CACHE_ROOT);
    const n2 = copyDirIfMissing(LEGACY_CACHE_ROOT, CACHE_ROOT);
    if (n1 + n2 > 0) {
      console.log(`[erkapharm-feed] migrated cache into ${CACHE_ROOT}`);
    }
  }
}

export function getStorageStats() {
  ensureDataDirs();
  let partners = 0;
  let cacheFiles = 0;
  try {
    const j = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    partners = Array.isArray(j.clients) ? j.clients.length : 0;
  } catch {}
  if (fs.existsSync(CACHE_ROOT)) {
    for (const siteDir of fs.readdirSync(CACHE_ROOT)) {
      const p = path.join(CACHE_ROOT, siteDir);
      try {
        if (!fs.statSync(p).isDirectory()) continue;
        cacheFiles += fs.readdirSync(p).filter(f => f.endsWith('.xml.gz')).length;
      } catch {}
    }
  }
  return {
    dataDir: DATA_DIR,
    clientsFile: CLIENTS_FILE,
    cacheRoot: CACHE_ROOT,
    partners,
    cacheFiles,
    volumeWritable: isWritableDir(DATA_DIR),
  };
}

migrateToDataDir();
