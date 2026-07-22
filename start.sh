#!/bin/sh

set -u

SYMTYPE_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SYMTYPE_SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "SymType 启动失败：找不到 Node.js。"
  printf '%s\n' "请安装 Node.js 22 LTS（22.12 或更新）或 24 LTS，然后重试。"
  SYMTYPE_EXIT_CODE=1
else
  node "$SYMTYPE_SCRIPT_DIR/scripts/start-local.mjs" "$@"
  SYMTYPE_EXIT_CODE=$?
fi

if [ "$SYMTYPE_EXIT_CODE" -ne 0 ] && [ -t 0 ] && [ "${CI:-}" != "true" ]; then
  printf '\n%s' "按 Enter 键关闭此窗口…"
  read -r SYMTYPE_DISMISSED
fi

exit "$SYMTYPE_EXIT_CODE"
