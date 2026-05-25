# ЭРКАФАРМ Feed Scanner — деплой

## GitHub

Репозиторий: `https://github.com/zapnikita95/erko-feed-scanner`

```bash
cd anyquery-feed-scanner
git init
git add .
git commit -m "Erko Farm feed scanner: auth, persistent partners and cache"
git remote add origin https://github.com/zapnikita95/erko-feed-scanner.git
git push -u origin main
```

## Railway

1. **New Project** → Deploy from GitHub → `erko-feed-scanner`
2. **Volume** → mount path **`/data`** (партнёры + кэш XML сохраняются между деплоями и редеплоями)
3. **Variables:**
   - `SESSION_SECRET` — случайная строка 32+ символов
   - `DATA_DIR` = `/data` (дублирует startCommand; без этого на Railway всё равно подхватится `/data`, если есть Volume)
   - `NODE_ENV` = `production`
   - `ERKO_ACCESS_SITE_IDS` = `6390,5335,292,8049` (по умолчанию; вход — любой email с доступом к одному из site в Dashboard)
4. После деплоя открыть URL → **Вход** (логин/пароль Dashboard + TOTP). После успешного входа кэш фидов **обновляется автоматически** (сначала Озерки, затем остальные бренды). Вручную — кнопка **«Обновить кэш»** в шапке.

## Что хранится на Volume

| Путь | Содержимое |
|------|------------|
| `/data/clients.local.json` | Список партнёров (озерки, Столетов, Самсон + новые через +) |
| `/data/cache/<siteId>/` | Скачанные XML-фиды |
| `/data/sessions/` | Сессии входа — **переживают редеплой** (нужен Volume + стабильный `SESSION_SECRET`) |
| `/data/cache_refresh_daily.json` | Счётчик полных обновлений кэша за сутки (лимит 3) |

**Сессии:** задай `SESSION_SECRET` в Variables Railway и **не меняй** его без нужды — иначе все куки станут недействительны. Cookie живёт 7 суток (`SESSION_MAX_AGE_MS`).

**Обновление кэша:** при входе — один раз в сутки (если сегодня уже было — пропуск). Кнопка «Обновить кэш» — до 3 полных прогонов в сутки (`CACHE_REFRESH_DAILY_LIMIT`). Часовой пояс суток: `Europe/Moscow`.

Проверка после деплоя: `GET /api/health` → в JSON поле `storage.dataDir` должно быть `/data`, `storage.volumeWritable: true`. После прогрева `storage.cacheFiles` растёт.

## Локально

```bash
npm install
npm start
# http://127.0.0.1:4173
```

Данные по умолчанию в `./data/`. Старый `./cache/` переносится в `data/cache` при первом старте.
