#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

npm --prefix apps/web run lint
npm --prefix apps/server run lint
npm --prefix apps/web run typecheck
node --test scripts/engineering-guards.test.mjs apps/server/scripts/test_dao_contracts.js
node scripts/audit-inline-sql.mjs
node scripts/gen-auth-matrix.mjs --check
npm test
npm run build
