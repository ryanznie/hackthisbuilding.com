#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VALIDATOR_DIR="$(cd "$ROOT_DIR/../validator" && pwd)"

for port in 5173 8787 8790; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the old local stack before starting a new one."
    exit 1
  fi
done

cleanup() {
  kill "${VALIDATOR_PID:-}" "${WORKER_PID:-}" "${VITE_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$VALIDATOR_DIR"
"$VALIDATOR_DIR/.venv/bin/python" app.py &
VALIDATOR_PID=$!

for _ in {1..30}; do
  curl -fsS http://127.0.0.1:8790/health >/dev/null 2>&1 && break
  sleep .1
done
curl -fsS http://127.0.0.1:8790/health >/dev/null

cd "$ROOT_DIR"
npm run build
npx wrangler dev --config wrangler.local.jsonc --port 8787 &
WORKER_PID=$!

for _ in {1..50}; do
  curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break
  sleep .1
done
curl -fsS http://127.0.0.1:8787/api/health >/dev/null

npx vite --host 127.0.0.1 &
VITE_PID=$!
wait "$VITE_PID"
