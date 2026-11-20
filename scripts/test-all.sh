#!/usr/bin/env bash
# 逐个运行 server 下所有 test_*.js，汇总通过/失败；失败的多数是环境门控（见 docs/engineering-standards.md）。
# 用法：bash scripts/test-all.sh [--quiet]
set -uo pipefail
cd "$(dirname "$0")/../apps/server"
pass=0; fail=0; : > /tmp/mamage_test_failures.txt
for f in scripts/test_*.js scripts/test_*.cjs; do
  [ -f "$f" ] || continue
  if timeout 90 node "$f" > /tmp/mamage_one_test.log 2>&1; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "$f :: $(tail -3 /tmp/mamage_one_test.log | tr '\n' ' ' | cut -c1-160)" >> /tmp/mamage_test_failures.txt
  fi
done
echo "server 测试：通过 ${pass}，失败 ${fail}"
if [ "$fail" -gt 0 ]; then
  echo "失败明细："
  cat /tmp/mamage_test_failures.txt
fi
