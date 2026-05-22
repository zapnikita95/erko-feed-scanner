#!/bin/bash
# Эрко Фарм Feed Scanner — запуск локального UI (macOS).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
cd "$DIR"
if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi
export PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"
echo "Эрко Фарм Feed Scanner → $URL"
echo "Остановка: закрой это окно или Ctrl+C."

if curl -sf "http://127.0.0.1:${PORT}/api/health" | grep -q '"app":"erko-feed-scanner"'; then
  echo "Сервер уже запущен и актуален."
  open "$URL"
  exit 0
fi

OLD_PIDS="$(lsof -ti tcp:${PORT} || true)"
if [[ -n "$OLD_PIDS" ]]; then
  echo "На порту ${PORT} запущена старая версия, перезапускаю..."
  kill $OLD_PIDS || true
  sleep 1
fi

(
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$URL"; then
      open "$URL"
      exit 0
    fi
    sleep 0.5
  done
  open "$URL" || true
) &

exec npm start
