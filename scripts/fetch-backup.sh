#!/usr/bin/env bash
# Downloads a backup made by "Nightly backup" (ADR-027) and decrypts it into <dir>.
#
#   bash scripts/fetch-backup.sh <run-id or empty for the latest successful backup> <dir>
#
# Needs GH_TOKEN (the workflow's token, actions: read) and BACKUP_PASSPHRASE.
set -euo pipefail
umask 077
run_id="${1:-}"; dir="$2"
if [ -z "$run_id" ]; then
  run_id="$(gh run list --workflow backup.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  [ -n "$run_id" ] || { echo "✗ No successful Nightly backup run found." >&2; exit 1; }
fi
download="$(mktemp -d)"
trap 'rm -rf "$download"' EXIT
gh run download "$run_id" --dir "$download" --pattern 'crm-backup-*'
mapfile -t files < <(find "$download" -name 'crm-backup-*.tar.gpg')
[ "${#files[@]}" = 1 ] || { echo "✗ Expected one backup file in run $run_id, found ${#files[@]} (expired after 30 days?)." >&2; exit 1; }
bash "$(dirname "$0")/backup-archive.sh" unpack "${files[0]}" "$dir"
echo "Using $(basename "${files[0]}") from Nightly backup run $run_id."
