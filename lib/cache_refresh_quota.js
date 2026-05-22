/**
 * Лимит полных обновлений кэша фидов: не чаще CACHE_REFRESH_DAILY_LIMIT раз в сутки.
 * Авто-прогрев при входе — только если сегодня ещё не было ни одного обновления.
 */

import fs from 'fs';
import path from 'path';
import { CACHE_REFRESH_LOG_FILE, ensureDataDirs } from '../config.js';

const DAILY_LIMIT = Math.max(1, Number(process.env.CACHE_REFRESH_DAILY_LIMIT) || 3);
const TZ = process.env.CACHE_REFRESH_TZ || 'Europe/Moscow';
const KEEP_DAYS = 14;

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function readLog() {
  ensureDataDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_REFRESH_LOG_FILE, 'utf8'));
    return raw && typeof raw === 'object' && raw.days ? raw : { days: {} };
  } catch {
    return { days: {} };
  }
}

function writeLog(data) {
  ensureDataDirs();
  const tmp = `${CACHE_REFRESH_LOG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CACHE_REFRESH_LOG_FILE);
}

function pruneOldDays(days) {
  const keys = Object.keys(days).sort();
  while (keys.length > KEEP_DAYS) {
    delete days[keys.shift()];
  }
}

export function getRefreshQuota() {
  const log = readLog();
  const date = todayKey();
  const entries = Array.isArray(log.days[date]) ? log.days[date] : [];
  const count = entries.length;
  return {
    date,
    count,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - count),
    loginAutoAllowed: count === 0,
    manualAllowed: count < DAILY_LIMIT,
    lastAt: entries.length ? entries[entries.length - 1].at : null,
  };
}

/**
 * @param {'login'|'manual'} source
 */
export function canStartRefresh(source) {
  const quota = getRefreshQuota();
  if (source === 'login') {
    if (!quota.loginAutoAllowed) {
      return {
        allowed: false,
        reason: 'already_refreshed_today',
        message: 'Кэш уже обновлялся сегодня — повторный прогрев при входе не нужен.',
        quota,
      };
    }
    return { allowed: true, quota };
  }
  if (!quota.manualAllowed) {
    return {
      allowed: false,
      reason: 'daily_limit',
      message: `Лимит обновлений на сегодня (${quota.limit}/${quota.limit}). Завтра снова.`,
      quota,
    };
  }
  return { allowed: true, quota };
}

/**
 * @param {'login'|'manual'} source
 */
export function recordRefresh(source) {
  const log = readLog();
  const date = todayKey();
  if (!Array.isArray(log.days[date])) log.days[date] = [];
  log.days[date].push({ at: Date.now(), source });
  pruneOldDays(log.days);
  writeLog(log);
  return getRefreshQuota();
}
