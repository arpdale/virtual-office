#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "[dev] Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "[dev] All processes stopped."
}
trap cleanup EXIT INT TERM

# Backend (FastAPI on :8100)
echo "[dev] Starting boardroom-backend on :8100..."
(
  cd "$DIR/boardroom-backend"
  source .venv/bin/activate
  exec uvicorn boardroom.main:app --reload --port 8100
) &
PIDS+=($!)

# Pixel Agents server (Fastify on :3100)
echo "[dev] Starting pixel-agents server on :3100..."
(
  cd "$DIR"
  exec node dist/cli.mjs --port 3100
) &
PIDS+=($!)

# Webview dev server (Vite on :5173)
echo "[dev] Starting webview-ui dev server on :5173..."
(
  cd "$DIR/webview-ui"
  exec npx vite --port 5173
) &
PIDS+=($!)

echo ""
echo "[dev] All services running:"
echo "  Backend API:    http://127.0.0.1:8100"
echo "  Pixel Agents:   http://127.0.0.1:3100"
echo "  Webview (dev):  http://127.0.0.1:5173"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

wait
