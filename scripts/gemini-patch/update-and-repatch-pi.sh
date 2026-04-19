#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

DO_UPDATE=1
if [[ "${1:-}" == "--no-update" ]]; then
  DO_UPDATE=0
elif [[ -n "${1:-}" ]]; then
  echo "Uso: $(basename "$0") [--no-update]"
  exit 1
fi

if [[ "$DO_UPDATE" -eq 1 ]]; then
  echo "[1/3] Actualizando @mariozechner/pi-coding-agent global..."
  npm i -g @mariozechner/pi-coding-agent@latest
else
  echo "[1/3] Saltando update (--no-update)"
fi

echo "[2/3] Reaplicando patch Gemini headers..."
bash "$SCRIPT_DIR/patch-global-pi.sh"

echo "[3/3] Verificando patch..."
bash "$SCRIPT_DIR/check-global-pi-patch.sh"

echo "[ok] Flujo completo ✅"
