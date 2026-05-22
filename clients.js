/**
 * Партнёры сети Эрко Фарм — только из data/clients.local.json (+ дефолтный seed).
 */

import fs from 'fs';
import {
  CLIENTS_FILE,
  ERKO_DEFAULT_CLIENTS,
  ensureDataDirs,
} from './config.js';

ensureDataDirs();

export function extractSuperaptekaStoreCity(title) {
  const parts = String(title || '').split(',');
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1].trim();
  const words = tail.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words[0] === 'Санкт' && words[1] && /^Петербург/i.test(words[1])) return 'Санкт-Петербург';
  if (words[0] === 'Нижний' && words[1] && /^Новгород/i.test(words[1])) return 'Нижний Новгород';
  return words[0];
}

export function classifySuperapteka(f) {
  const id = String(f.externalId || '');
  const title = String(f.title || '');
  if (id === 'global' || /глобальн/i.test(title)) return { kind: 'global', city: null };
  if (id.startsWith('region_')) {
    const m = title.match(/Регион\s*-\s*(.+)$/i);
    const regionLabel = m ? m[1].trim() : title;
    return { kind: 'city', city: regionLabel };
  }
  if (/^\d+$/.test(id)) {
    return { kind: 'store', city: extractSuperaptekaStoreCity(title) };
  }
  return { kind: 'store', city: extractSuperaptekaStoreCity(title) };
}

function readLocalClientRecords() {
  try {
    const data = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    return Array.isArray(data.clients) ? data.clients : [];
  } catch {
    return [];
  }
}

function writeLocalClientRecords(clients) {
  ensureDataDirs();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify({ clients }, null, 2));
}

/** Дописывает дефолтных партнёров Эрко, если их ещё нет в файле. */
export function seedErkoDefaults() {
  const records = readLocalClientRecords();
  const byId = new Map(records.map((c) => [String(c.siteId), c]));
  let changed = false;
  for (const d of ERKO_DEFAULT_CLIENTS) {
    if (!byId.has(String(d.siteId))) {
      byId.set(String(d.siteId), { ...d });
      changed = true;
    }
  }
  if (changed || !records.length) {
    writeLocalClientRecords([...byId.values()]);
    console.log(`[erko-feed-scanner] partners seeded → ${CLIENTS_FILE}`);
  }
}

seedErkoDefaults();

function normalizeLocalClient(record) {
  return {
    siteId: String(record.siteId),
    name: String(record.name || '').trim(),
    feedsListUrl: String(record.feedsListUrl || '').trim(),
    metaCacheName: 'feeds_list.json',
    classify: classifySuperapteka,
  };
}

function allClients() {
  const out = {};
  for (const record of readLocalClientRecords()) {
    if (!record?.siteId || !record?.name || !record?.feedsListUrl) continue;
    out[String(record.siteId)] = normalizeLocalClient(record);
  }
  return out;
}

export function defaultSiteId() {
  const ids = Object.keys(allClients());
  return ids[0] || '6390';
}

export function getClient(siteId) {
  const id = String(siteId ?? defaultSiteId());
  const c = allClients()[id];
  if (!c) throw new Error(`Unknown siteId: ${id}. Добавьте партнёра через +.`);
  return c;
}

export function listClients() {
  return Object.values(allClients())
    .map(({ siteId, name, feedsListUrl }) => ({ siteId, name, feedsListUrl }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function addLocalClient({ siteId, name, feedsListUrl }) {
  const normalized = {
    siteId: String(siteId || '').trim(),
    name: String(name || '').trim(),
    feedsListUrl: String(feedsListUrl || '').trim(),
  };
  if (!/^\d+$/.test(normalized.siteId)) {
    throw new Error('siteID должен состоять только из цифр.');
  }
  if (!normalized.name) throw new Error('Укажите имя партнёра.');
  try {
    const u = new URL(normalized.feedsListUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new Error('Укажите корректный URL мастер-фида.');
  }

  const records = readLocalClientRecords();
  const idx = records.findIndex((c) => String(c.siteId) === normalized.siteId);
  if (idx >= 0) records[idx] = normalized;
  else records.push(normalized);
  writeLocalClientRecords(records);
  return normalizeLocalClient(normalized);
}
