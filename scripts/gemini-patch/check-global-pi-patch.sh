#!/usr/bin/env bash
set -euo pipefail

TARGET="$(npm root -g)/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/providers/google-gemini-cli.js"

if [[ ! -f "$TARGET" ]]; then
  echo "[error] No encontré target: $TARGET"
  exit 1
fi

if rg -n "PI_GOOGLE_USER_AGENT|PI_GOOGLE_X_GOOG_API_CLIENT|PI_GOOGLE_CLIENT_METADATA|PI_GOOGLE_REQUEST_USER_AGENT" "$TARGET" >/dev/null; then
  echo "[ok] Patch parece aplicado ✅"
  rg -n "PI_GOOGLE_USER_AGENT|PI_GOOGLE_X_GOOG_API_CLIENT|PI_GOOGLE_CLIENT_METADATA|PI_GOOGLE_REQUEST_USER_AGENT" "$TARGET"
else
  echo "[error] Patch NO aplicado ❌"
  exit 1
fi
