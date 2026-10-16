#!/usr/bin/env bash
# Encrypts and decrypts CRM backups (ADR-027).
#
#   bash scripts/backup-archive.sh pack   <dir> <archive.tar.gpg>   manifest.json + data.sql → encrypted archive
#   bash scripts/backup-archive.sh unpack <archive.tar.gpg> <dir>   encrypted archive → manifest.json + data.sql
#
# AES-256 with the passphrase in BACKUP_PASSPHRASE (a GitHub secret, copy in the owner's password
# manager). Without the passphrase a backup cannot be read, by anyone. Never prints the passphrase.
set -euo pipefail
umask 077

if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "✗ BACKUP_PASSPHRASE is missing or shorter than 20 characters." >&2
  exit 1
fi

gpg_common=(--batch --quiet --no-tty --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3)
export GNUPGHOME="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME"' EXIT

case "${1:-}" in
  pack)
    dir="$2"; out="$3"
    for f in manifest.json data.sql; do
      [ -s "$dir/$f" ] || { echo "✗ $dir/$f is missing or empty." >&2; exit 1; }
    done
    tar -C "$dir" -cf - manifest.json data.sql |
      gpg "${gpg_common[@]}" --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
        --output "$out" 3<<<"$BACKUP_PASSPHRASE"
    # Prove the archive opens and holds exactly what was packed.
    check="$(mktemp -d)"
    gpg "${gpg_common[@]}" --decrypt "$out" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$check" -xf -
    for f in manifest.json data.sql; do cmp -s "$dir/$f" "$check/$f" || { rm -rf "$check"; echo "✗ Archive check failed for $f." >&2; exit 1; }; done
    rm -rf "$check"
    ;;
  unpack)
    in="$2"; dir="$3"
    mkdir -p "$dir"
    if ! gpg "${gpg_common[@]}" --decrypt "$in" 3<<<"$BACKUP_PASSPHRASE" > "$dir/archive.tar"; then
      rm -f "$dir/archive.tar"
      echo "✗ Could not decrypt the backup (wrong BACKUP_PASSPHRASE, or the file is damaged)." >&2
      exit 1
    fi
    tar -C "$dir" -xf "$dir/archive.tar" manifest.json data.sql
    rm -f "$dir/archive.tar"
    ;;
  *)
    echo "Usage: bash scripts/backup-archive.sh pack <dir> <archive> | unpack <archive> <dir>" >&2
    exit 1
    ;;
esac
