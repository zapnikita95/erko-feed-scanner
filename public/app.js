const LS_SITE = 'erko-feed-scanner-siteId';
const LS_MAIN_TAB = 'erko-feed-scanner-main-tab';

const state = {
  siteId: '6390',
  mainTab: 'all',
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
  });
}

function switchMainTab(tab) {
  const next = tab === 'brand' ? 'brand' : 'all';
  state.mainTab = next;
  localStorage.setItem(LS_MAIN_TAB, next);
  $$('.main-tab').forEach((t) => {
    const on = t.dataset.mainTab === next;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.main-tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.mainPanel !== next);
  });
  if (next === 'all') {
    loadNetworkSummary();
  } else {
    loadFeeds().catch((e) => setStatus('error', String(e.message || e)));
  }
}

function initMainTabs() {
  const preferred = localStorage.getItem(LS_MAIN_TAB);
  switchMainTab(preferred === 'brand' ? 'brand' : 'all');
  $$('.main-tab').forEach((t) => {
    t.addEventListener('click', () => switchMainTab(t.dataset.mainTab));
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
  const titleEl = $('#results-title');
  if (titleEl) {
    titleEl.textContent = state.clientName
      ? `Результаты: ${state.clientName} (site_id ${state.siteId})`
      : 'Результаты по бренду';
  }
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

let cacheRefreshPollTimer = null;
let networkSearchAbort = null;

function setNetworkSearchProgress(percent, text, cls = '') {
  const box = $('#network-search-progress');
  const bar = $('#network-search-bar');
  const status = $('#network-search-status');
  if (!box || !bar || !status) return;
  box.classList.remove('hidden');
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  status.className = `progress-status ${cls}`;
  status.textContent = text;
}

function hideNetworkSearchProgress(delayMs = 4000) {
  setTimeout(() => {
    $('#network-search-progress')?.classList.add('hidden');
  }, delayMs);
}

function sortFeedResultRows(a, b) {
  if (a.kind !== b.kind) {
    const rank = { global: 0, city: 1, store: 2 };
    return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
  }
  return a.title.localeCompare(b.title, 'ru');
}

function groupNetworkBrandResults(rows) {
  const global = [];
  const cityFeeds = [];
  const storesByRegion = new Map();
  for (const r of rows) {
    if (r.kind === 'global') global.push(r);
    else if (r.kind === 'city') cityFeeds.push(r);
    else if (r.kind === 'store') {
      const region = r.city || 'Без региона';
      if (!storesByRegion.has(region)) storesByRegion.set(region, []);
      storesByRegion.get(region).push(r);
    } else {
      const region = r.city || 'Прочее';
      if (!storesByRegion.has(region)) storesByRegion.set(region, []);
      storesByRegion.get(region).push(r);
    }
  }
  global.sort(sortFeedResultRows);
  cityFeeds.sort(sortFeedResultRows);
  for (const list of storesByRegion.values()) list.sort(sortFeedResultRows);
  return { global, cityFeeds, storesByRegion };
}

function buildBrandNetworkBlock(brand) {
  const details = document.createElement('details');
  details.className = 'brand-group';
  details.open = true;

  const { global, cityFeeds, storesByRegion } = groupNetworkBrandResults(brand.results);
  const summary = document.createElement('summary');
  summary.textContent = `${brand.name} (site ${brand.siteId}) — ${brand.hitsCount} совпадений`;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'brand-body';

  const topRows = [...global, ...cityFeeds];
  if (topRows.length) {
    const tier = document.createElement('div');
    tier.className = 'feed-tier';
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `Global и региональные фиды (${topRows.length})`;
    tier.appendChild(title);
    tier.appendChild(buildHitTable(topRows));
    body.appendChild(tier);
  }

  if (storesByRegion.size) {
    const tier = document.createElement('div');
    tier.className = 'feed-tier stores-tier';
    const title = document.createElement('div');
    title.className = 'group-title';
    const storeFeeds = [...storesByRegion.values()].reduce((n, arr) => n + arr.length, 0);
    title.textContent = `Точки по регионам (${storeFeeds})`;
    tier.appendChild(title);

    const regions = [...storesByRegion.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [region, rows] of regions) {
      const regDetails = document.createElement('details');
      regDetails.className = 'region-group';
      const regSummary = document.createElement('summary');
      regSummary.textContent = `${region} — ${rows.length} точек`;
      regDetails.appendChild(regSummary);
      const regBody = document.createElement('div');
      regBody.className = 'region-body';
      regBody.appendChild(buildHitTable(rows));
      regDetails.appendChild(regBody);
      tier.appendChild(regDetails);
    }
    body.appendChild(tier);
  }

  details.appendChild(body);
  return details;
}

function renderNetworkResultsList(brands) {
  const out = $('#network-results');
  if (!out) return;
  out.innerHTML = '';
  if (!brands?.length) {
    const p = document.createElement('p');
    p.className = 'nohit';
    p.textContent = 'Совпадений не найдено ни у одного бренда.';
    out.appendChild(p);
    return;
  }
  for (const brand of brands) {
    out.appendChild(buildBrandNetworkBlock(brand));
  }
}

function appendBrandNetworkResult(brand) {
  const out = $('#network-results');
  if (!out) return;
  const empty = out.querySelector('.nohit');
  if (empty) empty.remove();
  out.appendChild(buildBrandNetworkBlock(brand));
}

function renderNetworkResults(data) {
  renderNetworkResultsList(Array.isArray(data) ? data : data?.brands || []);
}

async function runNetworkSearch() {
  const query = $('#network-query')?.value?.trim();
  if (!query) {
    setNetworkStatus('error', 'Введите запрос');
    return;
  }

  if (networkSearchAbort) networkSearchAbort.abort();
  networkSearchAbort = new AbortController();
  const signal = networkSearchAbort.signal;

  const runBtn = $('#network-run');
  if (runBtn) runBtn.disabled = true;

  $('#network-results').innerHTML = '';
  setNetworkStatus('loading', 'Сканируем бренды по очереди…');
  setNetworkSearchProgress(2, 'Загружаем список брендов…');

  const started = performance.now();
  let feedsScanned = 0;
  let hitsCount = 0;
  const brandsOut = [];

  try {
    if (!state.clients.length) await refreshClients();
    const clients = [...state.clients];
    const total = clients.length;
    if (!total) throw new Error('Нет партнёров для поиска');

    for (let i = 0; i < total; i++) {
      if (signal.aborted) return;
      const c = clients[i];
      const pct = Math.round((i / total) * 100);
      setNetworkSearchProgress(pct, `${i + 1}/${total}: сканируем ${c.name}…`);

      const res = await apiFetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, siteId: c.siteId }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);

      feedsScanned += data.feedsScanned || 0;
      const hits = (data.results || []).filter((r) => r.matches?.length);
      hitsCount += hits.length;

      if (hits.length) {
        const brandBlock = {
          siteId: c.siteId,
          name: c.name,
          hitsCount: hits.length,
          results: hits,
        };
        brandsOut.push(brandBlock);
        appendBrandNetworkResult(brandBlock);
      }

      setNetworkSearchProgress(
        Math.round(((i + 1) / total) * 100),
        `${i + 1}/${total}: ${c.name} — ${hits.length ? `${hits.length} совпадений` : 'нет совпадений'}`,
      );
    }

    const ms = Math.round(performance.now() - started);
    if (!brandsOut.length) {
      renderNetworkResultsList([]);
    }
    setNetworkSearchProgress(100, `Готово: ${total} брендов, ${hitsCount} совпадений`, 'success');
    setNetworkStatus(
      '',
      `Брендов: ${total}, фидов: ${feedsScanned}, совпадений: ${hitsCount}, ${ms} мс (клиент). Результаты появлялись по мере сканирования.`,
    );
    hideNetworkSearchProgress();
  } catch (e) {
    if (signal.aborted || String(e.message || e).includes('abort')) return;
    setNetworkSearchProgress(0, String(e.message || e), 'error');
    setNetworkStatus('error', String(e.message || e));
  } finally {
    if (runBtn) runBtn.disabled = false;
    networkSearchAbort = null;
  }
}

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

function formatRefreshQuotaHint(quota) {
  if (!quota) return '';
  const left = quota.remaining ?? 0;
  const limit = quota.limit ?? 3;
  const used = quota.count ?? 0;
  if (left <= 0) {
    return `Обновлений сегодня: ${used}/${limit} — лимит исчерпан, завтра снова.`;
  }
  return `Обновлений сегодня: ${used}/${limit}, осталось ${left}.`;
}

function updateRefreshCacheButton(quota, running) {
  const btn = $('#refresh-cache');
  if (!btn) return;
  btn.disabled = Boolean(running) || (quota && !quota.manualAllowed);
  const hint = quota ? formatRefreshQuotaHint(quota) : '';
  btn.title = quota && !quota.manualAllowed
    ? hint
    : hint
      ? `${hint} Скачать актуальные мастер-фиды и XML по всем брендам.`
      : 'Скачать актуальные мастер-фиды и XML по всем брендам';
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
    const quotaHint = formatRefreshQuotaHint(data.quota);
    setCacheRefreshProgress(
      pct,
      quotaHint && !data.running ? `${text} ${quotaHint}` : text,
      data.error ? 'error' : data.running ? '' : 'success',
    );

    updateRefreshCacheButton(data.quota, data.running);

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
    updateRefreshCacheButton(null, false);
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
  if (btn?.disabled) return;
  setCacheRefreshProgress(4, 'Запускаем обновление кэша (сначала Озерки)…');
  try {
    const res = await apiFetch('/api/cache/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (res.status === 429) {
      updateRefreshCacheButton(data.quota, false);
      setCacheRefreshProgress(100, data.error || data.message || 'Лимит обновлений на сегодня.', 'error');
      return;
    }
    if (res.status === 409) {
      startCacheRefreshPoll();
      return;
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    startCacheRefreshPoll();
  } catch (e) {
    updateRefreshCacheButton(null, false);
    setCacheRefreshProgress(0, String(e.message || e), 'error');
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
  const wrap = document.createElement('div');
  wrap.className = 'hit-results-wrap';
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
  wrap.appendChild(table);
  return wrap;
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
    $('#cache-info').textContent = `Кэш бренда site_id ${j.siteId}: ${j.cachedCount} XML на диске.`;
  } catch {}
}

function longFetchSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

$('#network-run')?.addEventListener('click', runNetworkSearch);
$('#network-query')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runNetworkSearch();
});
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
});
$$('.kind').forEach((el) =>
  el.addEventListener('change', () => {
    renderCitySummary();
    renderCitySelectionSummary();
  }),
);
$('#city-store-search').addEventListener('input', renderCityStoreList);
$('#clear-city-stores').addEventListener('click', () => {
  state.citySelectedFeedIds.clear();
  renderCityStoreList();
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
});
$$('.feed-tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.feed-tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    state.activeTab = t.dataset.tab;
    $$('.tab-content').forEach((c) => c.classList.toggle('hidden', c.dataset.tab !== state.activeTab));
    if (state.activeTab === 'cities') {
      renderCitySummary();
      renderCityStoreList();
    }
  }),
);
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
  initMainTabs();
  await initClients();
  const statusRes = await fetch('/api/cache/refresh/status', { credentials: 'include' });
  if (statusRes.ok) {
    const st = await statusRes.json();
    updateRefreshCacheButton(st.quota, st.running);
    if (st.running) {
      startCacheRefreshPoll();
    } else if (st.quota && !st.quota.loginAutoAllowed && st.quota.count > 0) {
      setCacheRefreshProgress(
        100,
        `Кэш уже актуален на сегодня (${st.quota.count}/${st.quota.limit}). ${formatRefreshQuotaHint(st.quota)}`,
        'success',
      );
      setTimeout(hideCacheRefreshProgress, 6000);
    }
  }
  if (state.mainTab === 'all') {
    await loadNetworkSummary();
  } else {
    await loadFeeds();
  }
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
