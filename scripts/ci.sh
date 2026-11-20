#!/usr/bin/env bash
# 本地 / CI 统一入口：lint → 单测 → 构建。任一步失败即退出。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 web lint（0 error 门槛）=="
(cd apps/web && node_modules/.bin/eslint src --max-warnings 100000)

echo "== 2/4 server lint（0 error 门槛）=="
(cd apps/server && node_modules/.bin/eslint . --max-warnings 100000)

echo "== 3/4 server 单测：调色 / 编辑链路 =="
(cd apps/server && node --test scripts/test_photo_tone.cjs scripts/test_photo_tone_render.cjs \
  scripts/test_photo_tone_routes.cjs scripts/test_photo_edit.cjs scripts/test_oidc_assignment_guard.js)

echo "== 4/4 构建 web =="
(cd apps/web && npm run build 2>&1 | tail -3)

echo "全部通过。"
