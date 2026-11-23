#!/usr/bin/env bash
# Run the maintained offline API suite; isolated database tests have their own entrypoint.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm --prefix apps/server test
