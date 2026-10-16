#!/usr/bin/env bash
# Loads <dir>/restore.sql (written by `backup-tool.mts prepare`) into a database, in ONE
# transaction: the CRM tables are emptied and refilled together, or nothing changes.
# Triggers are paused while loading (replica mode) so the copy does not re-run automation or
# add audit entries; foreign keys are re-checked afterwards by `backup-tool.mts check`.
#
#   bash scripts/restore-load.sh <database-url> <dir>
#
# The URL carries no password; psql reads PGPASSWORD. Output is discarded (it would echo data).
set -euo pipefail
url="$1"; dir="$2"
[ -s "$dir/restore.sql" ] || { echo "✗ $dir/restore.sql is missing; run backup-tool.mts prepare first." >&2; exit 1; }
"${PSQL:-psql}" "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -c "set session_replication_role = replica" -f "$dir/restore.sql" > /dev/null
echo "✓ Backup loaded (one transaction)."
