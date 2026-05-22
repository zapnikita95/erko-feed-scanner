import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Персистентные данные: на Railway смонтировать Volume в /data */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

export const CACHE_ROOT = path.join(DATA_DIR, 'cache');
export const CLIENTS_FILE = path.join(DATA_DIR, 'clients.local.json');
export const LEGACY_CACHE_ROOT = path.join(__dirname, 'cache');

/** Партнёры сети ЭРКАФАРМ (без amwine и прочих «онлайн» проектов). */
export const ERKO_DEFAULT_CLIENTS = [
  {
    siteId: '6390',
    name: 'Супераптека (озерки)',
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
}

/** Перенос локального cache/ → DATA_DIR/cache при первом запуске на Railway. */
export function migrateLegacyCache() {
  if (!fs.existsSync(LEGACY_CACHE_ROOT)) return;
  try {
    const legacyEntries = fs.readdirSync(LEGACY_CACHE_ROOT);
    if (!legacyEntries.length) return;
    const hasNew = fs.existsSync(CACHE_ROOT) && fs.readdirSync(CACHE_ROOT).length > 0;
    if (hasNew) return;
    for (const name of legacyEntries) {
      const src = path.join(LEGACY_CACHE_ROOT, name);
      const dst = path.join(CACHE_ROOT, name);
      if (!fs.existsSync(dst)) {
        fs.cpSync(src, dst, { recursive: true });
      }
    }
    console.log(`[erko-feed-scanner] migrated cache from ${LEGACY_CACHE_ROOT} → ${CACHE_ROOT}`);
  } catch (e) {
    console.warn('[erko-feed-scanner] cache migration skipped:', e.message || e);
  }
}
