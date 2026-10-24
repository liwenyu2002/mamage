#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: verify-mysql-compat.sh IMAGE}
name="mamage-mysql-verify-$$-$RANDOM"
volume="$name-data"
backup=$(mktemp)
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; rm -f "$backup"' EXIT

docker volume create "$volume" >/dev/null
# No network or published ports: the empty password belongs only to this disposable fixture.
docker run -d --name "$name" --network none --user 999:999 \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=compat \
  -v "$volume:/var/lib/mysql" "$image" \
  --innodb-buffer-pool-size=128M --innodb-numa-interleave=OFF >/dev/null

wait_ready() {
  for attempt in {1..90}; do
    if docker exec "$name" mysql --protocol=TCP -h127.0.0.1 -uroot -Dcompat -Nse 'SELECT 1' >/dev/null 2>&1; then return; fi
    sleep 2
  done
  docker logs "$name" >&2
  return 1
}

sql() { docker exec -i "$name" mysql -uroot --default-character-set=utf8mb4 -N -B compat "$@"; }
assert_value() {
  local actual
  actual=$(sql -e "$1")
  test "$actual" = "$2" || { printf 'Unexpected result: %s\n' "$actual" >&2; return 1; }
}

wait_ready
assert_value 'SELECT VERSION()' '9.6.0'
sql <<'SQL'
CREATE TABLE fixtures (id BIGINT PRIMARY KEY, state JSON NOT NULL, label VARCHAR(80) COLLATE utf8mb4_0900_ai_ci);
INSERT INTO fixtures VALUES (1, JSON_OBJECT('groups', JSON_ARRAY(JSON_OBJECT('id', 'folder-1', 'parentId', NULL))), 'MaMage');
START TRANSACTION;
UPDATE fixtures SET label='rolled-back' WHERE id=1;
ROLLBACK;
SQL
assert_value "SELECT CONCAT(JSON_UNQUOTE(JSON_EXTRACT(state, '$.groups[0].id')), ':', label) FROM fixtures" 'folder-1:MaMage'
assert_value "SELECT CONCAT(GET_LOCK('mamage:compat-fixture',0), ':', IS_USED_LOCK('mamage:compat-fixture')=CONNECTION_ID(), ':', RELEASE_LOCK('mamage:compat-fixture'))" '1:1:1'
docker restart "$name" >/dev/null
wait_ready
assert_value 'SELECT COUNT(*) FROM fixtures' '1'
docker exec "$name" mysqldump -uroot --no-tablespaces --set-gtid-purged=OFF --databases compat > "$backup"
sql -e 'DROP DATABASE compat'
docker exec -i "$name" mysql -uroot < "$backup"
assert_value "SELECT CONCAT(JSON_UNQUOTE(JSON_EXTRACT(state, '$.groups[0].id')), ':', label) FROM fixtures" 'folder-1:MaMage'
printf '%s\n' 'MySQL compatibility: initialization, JSON, locks, transaction rollback, restart and logical restore passed.'
