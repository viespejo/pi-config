#!/usr/bin/env bash
set -euo pipefail

# Manual smoke script for pi-editor modes.
#
# What it validates:
# 1) Usage path: no args -> exit 2 + usage message
# 2) Default invocation behaves as context mode
# 3) Explicit context mode works
# 4) Explicit plain mode works
# 5) No PI markers leak into exported temp files
#
# This script uses fake nvr/nvim binaries to avoid opening a real editor.

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SANDBOX="$(mktemp -d)"
BIN_DIR="$SANDBOX/bin"
mkdir -p "$BIN_DIR"

cleanup() {
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

cat > "$BIN_DIR/nvr" <<'EOF'
#!/usr/bin/env sh
# Simulate nvr installed but no reachable servers.
if [ "${1:-}" = "--serverlist" ]; then
  printf '\n'
  exit 0
fi
exit 2
EOF
chmod +x "$BIN_DIR/nvr"

cat > "$BIN_DIR/nvim" <<'EOF'
#!/usr/bin/env sh
# Simulate editor open/close success with no edits.
exit 0
EOF
chmod +x "$BIN_DIR/nvim"

print_header() {
  printf '\n=== %s ===\n' "$1"
}

print_header "1) Usage check"
set +e
PATH="$BIN_DIR:$PATH" node "$ROOT_DIR/scripts/pi-editor.mjs" >"$SANDBOX/usage.stdout" 2>"$SANDBOX/usage.stderr"
USAGE_EXIT=$?
set -e
cat "$SANDBOX/usage.stderr"
printf 'Exit code: %s\n' "$USAGE_EXIT"
if [ "$USAGE_EXIT" -ne 2 ]; then
  echo "FAIL: expected usage exit code 2"
  exit 1
fi

print_header "2) Default invocation (context mode)"
DEFAULT_FILE="$SANDBOX/default-context.md"
printf 'Prompt default context mode\n' > "$DEFAULT_FILE"
PATH="$BIN_DIR:$PATH" PI_EDITOR_ENABLED=1 PI_EDITOR_WORKING_MODE=temp \
  node "$ROOT_DIR/scripts/pi-editor.mjs" "$DEFAULT_FILE"
cat "$DEFAULT_FILE"

print_header "3) Explicit context mode"
EXPLICIT_CONTEXT_FILE="$SANDBOX/explicit-context.md"
printf 'Prompt explicit context mode\n' > "$EXPLICIT_CONTEXT_FILE"
PATH="$BIN_DIR:$PATH" PI_EDITOR_ENABLED=1 PI_EDITOR_WORKING_MODE=temp \
  node "$ROOT_DIR/scripts/pi-editor.mjs" --mode context "$EXPLICIT_CONTEXT_FILE"
cat "$EXPLICIT_CONTEXT_FILE"

print_header "4) Explicit plain mode"
PLAIN_FILE="$SANDBOX/plain.md"
printf 'Prompt plain mode\n' > "$PLAIN_FILE"
PATH="$BIN_DIR:$PATH" \
  node "$ROOT_DIR/scripts/pi-editor.mjs" --mode plain "$PLAIN_FILE"
cat "$PLAIN_FILE"

print_header "5) Marker leak check"
if rg -n "PI_CONTEXT_START|PI_PROMPT_START" "$SANDBOX"/*.md >/dev/null 2>&1; then
  echo "FAIL: marker leak detected"
  rg -n "PI_CONTEXT_START|PI_PROMPT_START" "$SANDBOX"/*.md || true
  exit 1
fi

echo "PASS: no marker leak detected"

echo
echo "Smoke script completed successfully."
