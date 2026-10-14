#!/usr/bin/env bash
# Disposable local PostgreSQL 16 for schema/RLS tests when Docker/Supabase CLI is unavailable.
# Listens on 127.0.0.1 only. Never point this at production. See ADR-003.
set -euo pipefail

PORT="${LOCAL_DB_PORT:-54329}"
DATA_DIR="${LOCAL_DB_DIR:-/tmp/bass-crm-local-db}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

run() {
  if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}

case "${1:-}" in
  start)
    if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
      mkdir -p "$DATA_DIR"
      [ "$(id -u)" = "0" ] && chown postgres "$DATA_DIR"
      run "$PG_BIN/initdb -D '$DATA_DIR' -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    run "$PG_BIN/pg_ctl -D '$DATA_DIR' -o \"-p $PORT -c listen_addresses=127.0.0.1 -k /tmp\" -l '$DATA_DIR/server.log' -w start >/dev/null"
    echo "Local test database running. Use:"
    echo "  export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    run "$PG_BIN/pg_ctl -D '$DATA_DIR' -m fast stop" || true
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 1
    ;;
esac
