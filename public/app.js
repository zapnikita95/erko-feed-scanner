const LS_SITE = 'erko-feed-scanner-siteId';

const state = {
  siteId: '6390',
  clients: [],
  feeds: [],
  cities: [],
  activeTab: 'cities',
  selectedFeedIds: new Set(),
  citySelectedFeedIds: new Set(),
  lastResults: null,
  feedsListUrl: '',
  clientName: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('auth_required');
  }
  return res;
}

async function ensureAuth() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) {
    window.location.href = '/login.html';
    throw new Error('auth_required');
  }
  return res.json();
}

function clientQuery(extra = {}) {
  const p = new URLSearchParams({ siteId: state.siteId, ...extra });
  return p.toString();
}

function withSite(body) {
  return { ...body, siteId: state.siteId };
}

function populateClientSelect(clients, preferredSiteId) {
  const sel = $('#client-site');
  sel.innerHTML = '';
  state.clients = clients || [];
  const valid = state.clients.some((c) => c.siteId === preferredSiteId);
  state.siteId = valid ? preferredSiteId : state.clients?.[0]?.siteId || '6390';
  for (const c of state.clients) {
    const opt = document.createElement('option');
    opt.value = c.siteId;
    opt.textContent = `${c.name} — site_id ${c.siteId}`;
    sel.appendChild(opt);
  }
  sel.value = state.siteId;
}

async function refreshClients(preferredSiteId = localStorage.getItem(LS_SITE)) {
  const res = await apiFetch('/api/clients');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  populateClientSelect(data.clients || [], preferredSiteId);
}

async function initClients() {
  await refreshClients();
  const sel = $('#client-site');
  sel.addEventListener('change', () => {
    state.siteId = sel.value;
    localStorage.setItem(LS_SITE, state.siteId);
    state.selectedFeedIds.clear();
    state.citySelectedFeedIds.clear();
    $('#city').value = '';
    $('#city-store-search').value = '';
    $('#feed-filter').value = '';
    loadFeeds();
    updateWarmButton();
  });
}

function setAddPartnerProgress(percent, text, cls = '') {
  const box = $('#add-partner-progress');
  const bar = $('#add-partner-bar');
  const status = $('#add-partner-status');
  box.classList.remove('hidden');
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  status.className = `progress-status ${cls}`;
  status.textContent = text;
}

function resetAddPartnerProgress() {
  $('#add-partner-bar').style.width = '0%';
  $('#add-partner-status').className = 'progress-status';
  $('#add-partner-status').textContent = '';
  $('#add-partner-progress').classList.add('hidden');
}

function toggleAddPartnerPanel(force) {
  const panel = $('#add-partner-panel');
  const shouldOpen = force ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  if (shouldOpen) $('#partner-name').focus();
}

function clearAddPartnerForm() {
  $('#partner-name').value = '';
  $('#partner-site-id').value = '';
  $('#partner-feed-url').value = '';
  resetAddPartnerProgress();
}

function startAddPartnerProgressTicker() {
  const steps = [
    [18, 'Проверяем мастер-фид...'],
    [45, 'Парсим список фидов...'],
    [72, 'Предобрабатываем первые XML-фиды...'],
  ];
  let i = 0;
  setAddPartnerProgress(8, 'Готовим запрос...');
  const timer = setInterval(() => {
    if (i >= steps.length) return;
    const [percent, text] = steps[i++];
    setAddPartnerProgress(percent, text);
  }, 900);
  return () => clearInterval(timer);
}

async function addPartner() {
  const name = $('#partner-name').value.trim();
  const siteId = $('#partner-site-id').value.trim();
  const feedsListUrl = $('#partner-feed-url').value.trim();
  if (!name || !siteId || !feedsListUrl) {
    setAddPartnerProgress(0, 'Заполните имя партнёра, siteID и URL мастер-фида.', 'error');
    return;
  }

  const submit = $('#add-partner-submit');
  submit.disabled = true;
  const stopTicker = startAddPartnerProgressTicker();
  try {
    const res = await apiFetch('/api/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, siteId, feedsListUrl }),
      signal: longFetchSignal(300_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Не удалось добавить партнёра');

    setAddPartnerProgress(
      100,
      `Готово: ${data.client.name}, ${data.feedsCount} фидов. Предобработка: ${data.preprocessed.ok}/${data.preprocessed.checked} OK.`,
      'success',
    );
    state.siteId = data.client.siteId;
    localStorage.setItem(LS_SITE, state.siteId);
    await refreshClients(state.siteId);
    state.selectedFeedIds.clear();
    state.citySelectedFeedIds.clear();
    $('#city').value = '';
    $('#city-store-search').value = '';
    $('#feed-filter').value = '';
    await loadFeeds();
    await loadNetworkSummary();
  } catch (e) {
    const msg = String(e.message || e);
    setAddPartnerProgress(
      100,
      msg.includes('Not Found')
        ? 'API добавления не найден. Перезапустите Feed Scanner.command: на порту открыта старая версия сервера.'
        : msg,
      'error',
    );
  } finally {
    stopTicker();
    submit.disabled = false;
  }
}

function updateClientMeta() {
  $('#feeds-list-url').textContent = state.feedsListUrl || '—';
  document.title = `ЭРКАФАРМ — ${state.clientName || state.siteId}`;
}

async function loadFeeds() {
  const res = await apiFetch(`/api/feeds?${clientQuery()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  state.feeds = data.feeds || [];
  state.cities = data.cities || [];
  state.feedsListUrl = data.feedsListUrl || '';
  state.clientName = data.clientName || '';
  updateClientMeta();
  populateCityDropdown();
  renderFeedList();
  renderCitySummary();
  updateCityStoreControls();
  renderCityStoreList();
  updateCacheInfo();
  updateWarmAllCount();
  updateWarmButton();
}

function populateCityDropdown() {
  const sel = $('#city');
  sel.innerHTML = '<option value="">— любой —</option>';
  for (const c of state.cities) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.storeCount} точек)`;
    sel.appendChild(opt);
  }
}

function sortFeedsForFilter(feeds, query) {
  const q = (query || '').trim().toLowerCase();
  const kindRank = { global: 0, city: 1, store: 2 };
  const matches = (f) => {
    if (!q) return true;
    return (
      f.title.toLowerCase().includes(q) ||
      (f.city || '').toLowerCase().includes(q) ||
      String(f.externalId).toLowerCase().includes(q)
    );
  };
  return feeds
    .filter(matches)
    .sort((a, b) => {
      if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind];
      return a.title.localeCompare(b.title, 'ru');
    });
}

function renderFeedList() {
  const q = $('#feed-filter').value;
  const sorted = sortFeedsForFilter(state.feeds, q);
  const list = $('#feed-list');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const f of sorted.slice(0, 500)) {
    const row = document.createElement('label');
    row.className =
      'feed-row' +
      (f.kind === 'city' ? ' city-row' : f.kind === 'global' ? ' global-row' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f.externalId;
    cb.checked = state.selectedFeedIds.has(f.externalId);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedFeedIds.add(f.externalId);
      else state.selectedFeedIds.delete(f.externalId);
      updateSelectedCount();
    });
    row.appendChild(cb);
    const title = document.createElement('span');
    title.textContent = f.title;
    row.appendChild(title);
    const tag = document.createElement('span');
    tag.className = 'tag ' + f.kind;
    tag.textContent = f.kind;
    row.appendChild(tag);
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = f.externalId;
    row.appendChild(ext);
    frag.appendChild(row);
  }
  if (sorted.length > 500) {
    const more = document.createElement('div');
    more.className = 'hint';
    more.style.padding = '8px 12px';
    more.textContent = `...показано 500 из ${sorted.length}. Уточните фильтр.`;
    frag.appendChild(more);
  }
  list.appendChild(frag);
  updateSelectedCount();
  updateWarmButton();
}

function updateSelectedCount() {
  $('#selected-count').textContent = state.selectedFeedIds.size;
}

function findCityWideFeed(cityName) {
  if (!cityName || !state.feeds.length) return null;
  const cityLower = cityName.toLowerCase();
  return state.feeds.find(
    (f) =>
      f.kind === 'city' &&
      (f.title.toLowerCase().includes(cityLower) ||
        cityLower.includes(f.title.split(/\s+/)[0]?.toLowerCase() || '')),
  );
}

function storesInSelectedCity() {
  const city = $('#city').value;
  if (!city) return [];
  return state.feeds.filter((f) => f.kind === 'store' && f.city === city);
}

function filterStoresByQuery(stores, rawQ) {
  const q = (rawQ || '').trim().toLowerCase();
  if (!q) return stores;
  const isDigits = /^\d+$/.test(q.trim());
  return stores.filter((f) => {
    const id = String(f.externalId).toLowerCase();
    const title = f.title.toLowerCase();
    if (isDigits) return id === q || id.startsWith(q);
    return title.includes(q) || id.includes(q);
  });
}

function updateCityStoreControls() {
  const city = $('#city').value;
  const search = $('#city-store-search');
  const clearBtn = $('#clear-city-stores');
  const hint = $('#city-store-hint');
  const hasCity = Boolean(city);
  search.disabled = !hasCity;
  clearBtn.disabled = !hasCity || state.citySelectedFeedIds.size === 0;
  if (!hasCity) {
    hint.textContent =
      'Выберите город/подпись выше — появится список точек. Отметьте фиды для точечного поиска (плюс регион/global по галочкам).';
  } else {
    const n = storesInSelectedCity().length;
    hint.textContent = `«${city}»: ${n} точечных фидов. Сузите список по адресу или ID. Без галочек сканируются все точки в группе.`;
  }
}

function renderCitySelectionSummary() {
  const el = $('#city-selection-summary');
  if (!state.citySelectedFeedIds.size) {
    el.textContent = '';
    return;
  }
  const titles = [...state.citySelectedFeedIds]
    .map((id) => state.feeds.find((f) => f.externalId === id))
    .filter(Boolean)
    .map((f) => `${f.title} [${f.externalId}]`);
  el.textContent = `Сканировать только: ${titles.join(' · ')}`;
}

function renderCityStoreList() {
  updateCityStoreControls();
  const list = $('#city-store-list');
  const city = $('#city').value;
  if (!city) {
    list.innerHTML = '';
    renderCitySelectionSummary();
    return;
  }
  const stores = filterStoresByQuery(storesInSelectedCity(), $('#city-store-search').value);
  stores.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  const max = 400;
  for (const f of stores.slice(0, max)) {
    const row = document.createElement('label');
    row.className = 'feed-row store-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f.externalId;
    cb.checked = state.citySelectedFeedIds.has(f.externalId);
    cb.addEventListener('change', () => {
      if (cb.checked) state.citySelectedFeedIds.add(f.externalId);
      else state.citySelectedFeedIds.delete(f.externalId);
      updateCityStoreControls();
      renderCitySelectionSummary();
    });
    row.appendChild(cb);
    const title = document.createElement('span');
    title.textContent = f.title;
    row.appendChild(title);
    const tag = document.createElement('span');
    tag.className = 'tag store';
    tag.textContent = 'store';
    row.appendChild(tag);
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = f.externalId;
    row.appendChild(ext);
    frag.appendChild(row);
  }
  if (stores.length > max) {
    const more = document.createElement('div');
    more.className = 'hint';
    more.style.padding = '8px 12px';
    more.textContent = `Показано ${max} из ${stores.length}. Уточните поиск.`;
    frag.appendChild(more);
  }
  list.appendChild(frag);
  renderCitySelectionSummary();
  updateWarmButton();
}

function renderCitySummary() {
  const city = $('#city').value;
  const kinds = currentKinds();
  if (!city) {
    const n = state.feeds.filter((f) => kinds.includes(f.kind)).length;
    $('#city-summary').textContent = `Без группы: в выбранных типах ${n} фидов из ${state.feeds.length}.`;
    return;
  }
  const stores = state.feeds.filter((f) => f.kind === 'store' && f.city === city);
  const cw = findCityWideFeed(city);
  const hasGlobal = state.feeds.some((f) => f.kind === 'global');
  let total = 0;
  if (kinds.includes('store')) total += stores.length;
  if (kinds.includes('city') && cw) total += 1;
  if (kinds.includes('global') && hasGlobal) total += 1;
  const parts = [];
  if (kinds.includes('store')) parts.push(`точек: ${stores.length}`);
  if (kinds.includes('city') && cw) parts.push(`агрегат: «${cw.title}» [${cw.externalId}]`);
  else if (kinds.includes('city') && !cw) parts.push('агрегат: не найден по подстроке');
  if (kinds.includes('global')) parts.push(`global: ${hasGlobal ? 'да' : 'нет'}`);
  $('#city-summary').textContent = `«${city}»: будет просканировано ${total} фидов (${parts.join('; ')}).`;
}

function currentKinds() {
  return $$('.kind:checked').map((x) => x.value);
}

function getCityPinnedFeedIds() {
  if (state.citySelectedFeedIds.size === 0) return null;
  const ids = [...state.citySelectedFeedIds];
  const kinds = currentKinds();
  const cityName = $('#city').value;
  if (kinds.includes('city')) {
    const cw = findCityWideFeed(cityName);
    if (cw && !ids.includes(cw.externalId)) ids.unshift(cw.externalId);
  }
  if (kinds.includes('global')) {
    const g = state.feeds.find((f) => f.kind === 'global');
    if (g && !ids.includes(g.externalId)) ids.push(g.externalId);
  }
  return ids;
}

function buildSearchPayload() {
  const query = $('#query').value.trim();
  let body = { query };
  if (state.activeTab === 'feeds' && state.selectedFeedIds.size) {
    body.feedIds = [...state.selectedFeedIds];
  } else if (state.activeTab === 'cities') {
    const pinned = getCityPinnedFeedIds();
    if (pinned) body.feedIds = pinned;
    else {
      body.city = $('#city').value || undefined;
      body.kinds = currentKinds();
    }
  } else {
    body.city = $('#city').value || undefined;
    body.kinds = currentKinds();
  }
  return withSite(body);
}

async function runSearch() {
  const payload = buildSearchPayload();
  if (!payload.query) {
    setStatus('error', 'Введите запрос');
    return;
  }
  setStatus('loading', 'Сканируем фиды...');
  const started = performance.now();
  try {
    const res = await apiFetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: longFetchSignal(1_200_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.lastResults = data;
    const ms = Math.round(performance.now() - started);
    const note = data.note ? ` ${data.note}` : '';
    setStatus(
      '',
      `Просканировано ${data.feedsScanned} фидов за ${data.elapsedMs} мс (сеть+кэш), клиент: ${ms} мс. Совпадений: ${data.hitsCount}.${note}`,
    );
    renderResults(data);
  } catch (e) {
    setStatus('error', String(e.message || e));
  }
}

function setStatus(cls, text) {
  const el = $('#status');
  el.className = 'status ' + (cls || '');
  el.textContent = text || '';
}

function setNetworkStatus(cls, text) {
  const el = $('#network-status');
  if (!el) return;
  el.className = 'status ' + (cls || '');
  el.textContent = text || '';
}

async function loadNetworkSummary() {
  const el = $('#network-summary');
  if (!el) return;
  try {
    const res = await apiFetch('/api/network-summary');
    const data = await res.json();
    const lines = (data.brands || []).map(
      (b) => `${b.name}: ${b.feedsCount} фидов, в кэше ${b.cachedCount} XML`,
    );
    el.textContent = `В сети ${data.brands?.length || 0} брендов, ${data.totalFeeds || 0} фидов, в кэше ${data.totalCached || 0} XML. ${lines.join(' · ')}`;
  } catch {
    el.textContent = '';
  }
}

function renderNetworkResults(data) {
  const out = $('#network-results');
  if (!out) return;
  out.innerHTML = '';
  if (!data.brands?.length) {
    const p = document.createElement('p');
    p.className = 'nohit';
    p.textContent = 'Совпадений не найдено ни у одного бренда.';
    out.appendChild(p);
    return;
  }
  for (const brand of data.brands) {
    const details = document.createElement('details');
    details.className = 'brand-group';
    details.open = data.brands.length <= 3;
    const summary = document.createElement('summary');
    summary.textContent = `${brand.name} (site ${brand.siteId}) — ${brand.hitsCount} совпадений`;
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'brand-body';
    body.appendChild(buildHitTable(brand.results));
    details.appendChild(body);
    out.appendChild(details);
  }
}

async function runNetworkSearch() {
  const query = $('#network-query')?.value?.trim();
  if (!query) {
    setNetworkStatus('error', 'Введите запрос');
    return;
  }
  setNetworkStatus('loading', 'Сканируем все бренды и фиды…');
  const started = performance.now();
  try {
    const res = await apiFetch('/api/search-all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: longFetchSignal(3_600_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const ms = Math.round(performance.now() - started);
    setNetworkStatus(
      '',
      `Брендов: ${data.brandsScanned}, фидов: ${data.feedsScanned}, совпадений: ${data.hitsCount}, ${data.elapsedMs} мс (сервер), ${ms} мс (клиент).`,
    );
    renderNetworkResults(data);
  } catch (e) {
    setNetworkStatus('error', String(e.message || e));
  }
}

let cacheRefreshPollTimer = null;

function setCacheRefreshProgress(percent, text, cls = '') {
  const box = $('#cache-refresh-progress');
  const bar = $('#cache-refresh-bar');
  const status = $('#cache-refresh-status');
  if (!box || !bar || !status) return;
  box.classList.remove('hidden');
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  status.className = `progress-status ${cls}`;
  status.textContent = text;
}

function hideCacheRefreshProgress() {
  const box = $('#cache-refresh-progress');
  if (box) box.classList.add('hidden');
}

function stopCacheRefreshPoll() {
  if (cacheRefreshPollTimer) {
    clearInterval(cacheRefreshPollTimer);
    cacheRefreshPollTimer = null;
  }
}

function formatCacheRefreshStatus(data) {
  if (data.running) {
    const cur = data.current ? ` · ${data.current}` : '';
    const prog = data.total ? ` ${data.warmed || 0}/${data.total} XML` : '';
    return `Обновляем кэш${cur}${prog}…`;
  }
  if (data.error) return `Ошибка обновления кэша: ${data.error}`;
  const warmed = data.warmed ?? 0;
  const total = data.total ?? 0;
  const failed = data.failed ?? 0;
  return `Кэш обновлён: ${warmed}/${total} XML${failed ? `, ошибок: ${failed}` : ''}.`;
}

async function pollCacheRefreshStatus() {
  try {
    const res = await apiFetch('/api/cache/refresh/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    const pct = data.total
      ? Math.round(((data.warmed || 0) / data.total) * 100)
      : data.running
        ? 8
        : 100;
    const text = formatCacheRefreshStatus(data);
    setCacheRefreshProgress(pct, text, data.error ? 'error' : data.running ? '' : 'success');

    const btn = $('#refresh-cache');
    if (btn) btn.disabled = Boolean(data.running);

    if (!data.running) {
      stopCacheRefreshPoll();
      await refreshClients();
      await loadFeeds();
      await loadNetworkSummary();
      updateCacheInfo();
      if (!data.error) setTimeout(hideCacheRefreshProgress, 8000);
    }
    return data;
  } catch (e) {
    stopCacheRefreshPoll();
    setCacheRefreshProgress(0, String(e.message || e), 'error');
    const btn = $('#refresh-cache');
    if (btn) btn.disabled = false;
    throw e;
  }
}

function startCacheRefreshPoll() {
  stopCacheRefreshPoll();
  pollCacheRefreshStatus().catch(() => {});
  cacheRefreshPollTimer = setInterval(() => {
    pollCacheRefreshStatus().catch(() => {});
  }, 2500);
}

async function requestCacheRefresh() {
  const btn = $('#refresh-cache');
  if (btn) btn.disabled = true;
  setCacheRefreshProgress(4, 'Запускаем обновление кэша (сначала Озерки)…');
  try {
    const res = await apiFetch('/api/cache/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (res.status === 409) {
      startCacheRefreshPoll();
      return;
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    startCacheRefreshPoll();
  } catch (e) {
    if (btn) btn.disabled = false;
    setCacheRefreshProgress(0, String(e.message || e), 'error');
  }
}

async function warmNetworkAll() {
  if (!confirm('Прогреть XML всех фидов всех брендов? Это может занять много времени.')) return;
  setNetworkStatus('loading', 'Прогреваем все фиды всех брендов…');
  try {
    const res = await apiFetch('/api/warm-all', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
      signal: longFetchSignal(7_200_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    setNetworkStatus(
      '',
      `Прогрето ${data.warmed}/${data.total} за ${data.elapsedMs} мс. Ошибок: ${data.failed}.`,
    );
    await loadNetworkSummary();
    updateCacheInfo();
  } catch (e) {
    setNetworkStatus('error', String(e.message || e));
  }
}

function renderResults(data) {
  const out = $('#results');
  out.innerHTML = '';
  if (data.note) {
    const note = document.createElement('p');
    note.className = 'hint results-note';
    note.textContent = data.note;
    out.appendChild(note);
  }
  const hits = data.results.filter((r) => r.matches.length);
  const errors = data.results.filter((r) => r.error);

  if (!hits.length) {
    const p = document.createElement('p');
    p.className = 'nohit';
    p.textContent = 'Совпадений не найдено ни в одном из выбранных фидов.';
    out.appendChild(p);
    const hasGlobal = state.feeds.some((f) => f.kind === 'global');
    const kinds = currentKinds();
    if (hasGlobal && !kinds.includes('global')) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent =
        'По slug или URL товар часто есть только в global-фиде. В точечных фидах — только по offer id. Включите галочку «global» или введите id (например 35329).';
      out.appendChild(hint);
    }
  } else {
    const groups = groupByCity(hits);
    for (const [city, rows] of groups) {
      const title = document.createElement('div');
      title.className = 'group-title';
      title.textContent = city ? `${city} (${rows.length})` : `Без группы (${rows.length})`;
      out.appendChild(title);
      out.appendChild(buildHitTable(rows));
    }
  }

  if (errors.length) {
    const errTitle = document.createElement('div');
    errTitle.className = 'group-title';
    errTitle.textContent = `Ошибки: ${errors.length}`;
    out.appendChild(errTitle);
    const ul = document.createElement('ul');
    for (const e of errors.slice(0, 20)) {
      const li = document.createElement('li');
      li.textContent = `${e.title} — ${e.error}`;
      ul.appendChild(li);
    }
    out.appendChild(ul);
  }
}

function groupByCity(rows) {
  const byCity = new Map();
  for (const r of rows) {
    const k = r.city || '';
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(r);
  }
  const sortedKeys = [...byCity.keys()].sort((a, b) => byCity.get(b).length - byCity.get(a).length);
  const out = [];
  for (const k of sortedKeys) {
    const arr = byCity.get(k).sort((a, b) => {
      if (a.kind !== b.kind) return (a.kind === 'city' ? 0 : 1) - (b.kind === 'city' ? 0 : 1);
      return a.title.localeCompare(b.title, 'ru');
    });
    out.push([k, arr]);
  }
  return out;
}

function feedUrlForResult(r) {
  if (r.feedUrl) return r.feedUrl;
  const f = state.feeds.find((x) => x.externalId === r.externalId);
  return f?.url || '';
}

function buildHitTable(rows) {
  const table = document.createElement('table');
  table.className = 'hit-results';
  table.innerHTML = `<colgroup>
    <col class="col-feed">
    <col class="col-type">
    <col class="col-id">
    <col class="col-price">
    <col class="col-stock">
    <col class="col-url">
  </colgroup>
  <thead><tr>
    <th>Фид</th><th>Тип</th><th>ID оффера</th><th>Цена</th><th>В наличии</th><th>URL товара</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const feedUrl = feedUrlForResult(r);
    const feedLink = feedUrl
      ? `<a class="feed-url" href="${escapeAttr(feedUrl)}" title="${escapeAttr(feedUrl)}" target="_blank" rel="noopener">Ссылка на фид</a>`
      : '';
    for (const m of r.matches) {
      const tr = document.createElement('tr');
      tr.className = 'hit';
      const productUrl = m.url
        ? `<a class="url" href="${escapeAttr(m.url)}" title="${escapeAttr(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.url)}</a>`
        : '<span class="nohit">—</span>';
      tr.innerHTML = `
        <td class="feed-cell">${escapeHtml(r.title)} <span class="ext">${escapeHtml(r.externalId)}</span>${feedLink ? `<div class="feed-link">${feedLink}</div>` : ''}</td>
        <td><span class="tag ${r.kind}">${r.kind}</span></td>
        <td>${escapeHtml(m.id)}</td>
        <td class="price">${escapeHtml(m.price)}${m.oldprice ? `<span class="oldprice">${escapeHtml(m.oldprice)}</span>` : ''}</td>
        <td>${m.available ? 'да' : 'нет'}</td>
        <td>${productUrl}</td>`;
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  return table;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

async function updateCacheInfo() {
  try {
    const res = await apiFetch(`/api/feed-status?${clientQuery()}`);
    const j = await res.json();
    $('#cache-info').textContent = `site_id ${j.siteId}: в кэше ${j.cachedCount} XML. TTL ~12 ч.`;
  } catch {}
}

function isWarmAllChecked() {
  const el = $('#warm-all');
  return Boolean(el && el.checked);
}

function canWarm() {
  if (isWarmAllChecked()) return true;
  if (state.activeTab === 'feeds' && state.selectedFeedIds.size > 0) return true;
  if (state.activeTab === 'cities' && $('#city').value) return true;
  if (state.activeTab === 'cities' && state.citySelectedFeedIds.size > 0) return true;
  return false;
}

function updateWarmAllCount() {
  const n = document.getElementById('warm-all-count');
  if (n) n.textContent = state.feeds.length ? String(state.feeds.length) : '—';
}

function updateWarmButton() {
  const btn = $('#warm');
  if (!btn) return;
  const ok = canWarm();
  btn.disabled = !ok;
  btn.title = ok
    ? isWarmAllChecked()
      ? 'Скачать в кэш все XML фидов партнёра (долго, но без парсинга офферов на этом шаге)'
      : 'Скачать XML в кэш для выбранного города / отмеченных фидов'
    : 'Выберите город, отметьте фиды или включите «прогреть все фиды» ниже.';
}

function longFetchSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function warmCache() {
  if (!canWarm()) {
    setStatus(
      'error',
      'Сначала выберите город, отметьте фиды или включите галочку «прогреть все фиды».',
    );
    return;
  }
  const city = $('#city').value;
  let payload;
  if (isWarmAllChecked()) {
    payload = { warmAll: true };
  } else if (state.activeTab === 'feeds' && state.selectedFeedIds.size) {
    payload = { feedIds: [...state.selectedFeedIds] };
  } else if (state.activeTab === 'cities' && state.citySelectedFeedIds.size > 0) {
    payload = { feedIds: getCityPinnedFeedIds() };
  } else {
    payload = { city: city || undefined, kinds: currentKinds() };
  }
  setStatus('loading', payload.warmAll ? 'Прогреваем все фиды (долго)…' : 'Прогреваем кэш...');
  try {
    const res = await apiFetch('/api/warm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withSite(payload)),
      signal: longFetchSignal(payload.warmAll ? 7_200_000 : 900_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText || 'Warm failed');
    setStatus('', `Прогрето ${j.warmed}/${j.total} за ${j.elapsedMs} мс. Ошибок: ${j.failed}.`);
    updateCacheInfo();
  } catch (e) {
    setStatus('error', String(e.message || e));
  }
}

$('#network-run')?.addEventListener('click', runNetworkSearch);
$('#network-query')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runNetworkSearch();
});
$('#network-warm')?.addEventListener('click', warmNetworkAll);
$('#run').addEventListener('click', runSearch);
$('#query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch();
});
$('#city').addEventListener('change', () => {
  state.citySelectedFeedIds.clear();
  $('#city-store-search').value = '';
  renderCitySummary();
  updateCityStoreControls();
  renderCityStoreList();
  updateWarmButton();
});
$$('.kind').forEach((el) =>
  el.addEventListener('change', () => {
    renderCitySummary();
    renderCitySelectionSummary();
    updateWarmButton();
  }),
);
$('#city-store-search').addEventListener('input', renderCityStoreList);
$('#clear-city-stores').addEventListener('click', () => {
  state.citySelectedFeedIds.clear();
  renderCityStoreList();
  updateWarmButton();
});
$('#feed-filter').addEventListener('input', renderFeedList);
$('#select-visible').addEventListener('click', () => {
  const q = $('#feed-filter').value;
  const sorted = sortFeedsForFilter(state.feeds, q);
  for (const f of sorted.slice(0, 500)) state.selectedFeedIds.add(f.externalId);
  renderFeedList();
});
$('#clear-selection').addEventListener('click', () => {
  state.selectedFeedIds.clear();
  renderFeedList();
  updateWarmButton();
});
$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    state.activeTab = t.dataset.tab;
    $$('.tab-content').forEach((c) => c.classList.toggle('hidden', c.dataset.tab !== state.activeTab));
    if (state.activeTab === 'cities') {
      renderCitySummary();
      renderCityStoreList();
    }
    updateWarmButton();
  }),
);
$('#warm').addEventListener('click', warmCache);
const warmAllEl = document.getElementById('warm-all');
if (warmAllEl) warmAllEl.addEventListener('change', updateWarmButton);
$('#toggle-add-partner').addEventListener('click', () => toggleAddPartnerPanel());
$('#add-partner-cancel').addEventListener('click', () => {
  clearAddPartnerForm();
  toggleAddPartnerPanel(false);
});
$('#add-partner-submit').addEventListener('click', addPartner);
['#partner-name', '#partner-site-id', '#partner-feed-url'].forEach((sel) => {
  $(sel).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPartner();
  });
});

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login.html';
}

async function boot() {
  await ensureAuth();
  await initClients();
  const statusRes = await fetch('/api/cache/refresh/status', { credentials: 'include' });
  if (statusRes.ok) {
    const st = await statusRes.json();
    if (st.running) startCacheRefreshPoll();
  }
  await loadFeeds();
  await loadNetworkSummary();
}
boot().catch((e) => {
  if (String(e.message || e) === 'auth_required') return;
  setStatus('error', String(e.message || e));
});

const logoutBtn = document.getElementById('logout');
if (logoutBtn) logoutBtn.addEventListener('click', logout);
const refreshCacheBtn = document.getElementById('refresh-cache');
if (refreshCacheBtn) {
  refreshCacheBtn.addEventListener('click', () => {
    if (
      !confirm(
        'Обновить кэш по всем брендам? Сначала Озерки, затем остальные. Скачаются актуальные мастер-фиды и XML.',
      )
    ) {
      return;
    }
    requestCacheRefresh();
  });
}
