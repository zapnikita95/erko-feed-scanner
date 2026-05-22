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
   - `ALLOWED_EMAIL_SUFFIXES` = `@diginetica.com,@anyquery.ru,@tbank.ru` (при необходимости)
4. После деплоя открыть URL → **Вход** (логин/пароль Dashboard + TOTP)

## Что хранится на Volume

| Путь | Содержимое |
|------|------------|
| `/data/clients.local.json` | Список партнёров (озерки, Столетов, Самсон + новые через +) |
| `/data/cache/<siteId>/` | Скачанные XML-фиды (прогрев не нужен повторять после перезапуска) |

Проверка после деплоя: `GET /api/health` → в JSON поле `storage.dataDir` должно быть `/data`, `storage.volumeWritable: true`. После прогрева `storage.cacheFiles` растёт.

## Локально

```bash
npm install
npm start
# http://127.0.0.1:4173
```

Данные по умолчанию в `./data/`. Старый `./cache/` переносится в `data/cache` при первом старте.
