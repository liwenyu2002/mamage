#!/usr/bin/env bash
# 可追溯发布：镜像只允许从「已提交的 SHA」构建，tag 与 SHA 绑定。
# 用法：scripts/release-image.sh <api|web> [ssh-host]
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?用法: scripts/release-image.sh <api|web> [host]}"
host="${2:-ubuntu@10.1.131.37}"

if [ -n "$(git status --porcelain)" ]; then
  echo "工作树有未提交改动，拒绝构建可追溯镜像。先 commit 或 stash。" >&2
  exit 1
fi

sha="$(git rev-parse --short=12 HEAD)"
tmp="$(mktemp -d)"
case "$target" in
  api)
    git archive HEAD apps/server | tar -x -C "$tmp"
    tar -czf "$tmp/api-$sha.tgz" -C "$tmp" apps/server
    scp -q "$tmp/api-$sha.tgz" "$host:/tmp/"
    ssh "$host" "set -e; rm -rf /tmp/rel-$sha && mkdir -p /tmp/rel-$sha && tar -xzf /tmp/api-$sha.tgz -C /tmp/rel-$sha && \
      chmod -R a+rX /tmp/rel-$sha && printf 'FROM mamage-api:current\nCOPY apps/server/ /app/\n' > /tmp/rel-$sha/Dockerfile && \
      cd /tmp/rel-$sha && sudo docker build -q -t mamage-api:release-$sha . && sudo docker save mamage-api:release-$sha | sudo k3s ctr images import - && \
      echo \"built mamage-api:release-$sha\""
    ;;
  web)
    (cd apps/web && npm run build >/dev/null)
    tar -czf "$tmp/web-$sha.tgz" -C apps/web dist
    scp -q "$tmp/web-$sha.tgz" "$host:/tmp/"
    ssh "$host" "set -e; rm -rf /tmp/relweb-$sha && mkdir -p /tmp/relweb-$sha && tar -xzf /tmp/web-$sha.tgz -C /tmp/relweb-$sha && \
      printf 'FROM mamage-web:current\nCOPY dist/ /usr/share/nginx/html/\n' > /tmp/relweb-$sha/Dockerfile && \
      cd /tmp/relweb-$sha && sudo docker build -q -t mamage-web:release-$sha . && sudo docker save mamage-web:release-$sha | sudo k3s ctr images import - && \
      echo \"built mamage-web:release-$sha\""
    ;;
  *) echo "target 只能是 api 或 web" >&2; exit 2 ;;
esac
rm -rf "$tmp"
echo "镜像 tag: release-$sha（部署请用 kubectl set image 显式指向该 tag）"
