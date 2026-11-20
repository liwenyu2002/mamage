#!/usr/bin/env bash
# 本地 / CI 统一入口：lint → 类型检查 → SQL 棘轮 → 单测 → 构建。任一步失败即退出。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 web lint（0 error 门槛）=="
(cd apps/web && node_modules/.bin/eslint src --max-warnings 100000)

echo "== 2/5 server lint（0 error 门槛）=="
(cd apps/server && node_modules/.bin/eslint . --max-warnings 100000)

echo "== 3/5 TypeScript 类型检查（新 .ts 模块）=="
(cd apps/web && npx tsc -p tsconfig.json --noEmit)

echo "== 4/5 内联 SQL 棘轮（基线 315，只降不升）=="
node scripts/audit-inline-sql.mjs --fail-over 315 | head -3

echo "== 5/6 server 单测：调色 / 编辑 / 删除鉴权 =="
(cd apps/server && node --test scripts/test_photo_tone.cjs scripts/test_photo_tone_render.cjs \
  scripts/test_photo_tone_routes.cjs scripts/test_photo_edit.cjs scripts/test_photo_delete_ownership.js \
  scripts/test_oidc_assignment_guard.js)

echo "== 6/6 构建 web =="
(cd apps/web && npm run build 2>&1 | tail -3)

echo "全部通过。"
