#!/usr/bin/env bash
set -euo pipefail

TARGET="$(npm root -g)/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/providers/google-gemini-cli.js"
PATCH_FILE="$(cd "$(dirname "$0")" && pwd)/pi-gemini-headers.patch"

echo "[info] target: $TARGET"
echo "[info] patch : $PATCH_FILE"

if [[ ! -f "$TARGET" ]]; then
  echo "[error] No encontré target: $TARGET"
  exit 1
fi

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "[error] No encontré patch: $PATCH_FILE"
  echo "        Crea primero scripts/gemini-patch/pi-gemini-headers.patch"
  exit 1
fi

# --forward: ignora hunks ya aplicados (idempotente)
# --batch: no interactivo
if patch --forward --batch "$TARGET" "$PATCH_FILE"; then
  echo "[ok] Patch aplicado (o ya estaba aplicado)."
else
  echo "[error] Falló al aplicar patch. Puede que la versión instalada haya cambiado demasiado."
  exit 1
fi
