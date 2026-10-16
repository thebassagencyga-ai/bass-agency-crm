#!/usr/bin/env bash
# Signed-out smoke test of a deployed CRM (Phase 12, ADR-026). Read-only: sends GET requests
# and one unauthenticated POST that must be refused. Never signs in, never touches data.
#   bash scripts/smoke-test.sh https://bass-agency-crm.<subdomain>.workers.dev
set -uo pipefail
SITE="${1:?usage: smoke-test.sh <site-url>}"
SITE="${SITE%/}"
fail=0
ok() { echo "✓ $1"; }
bad() { echo "✗ $1"; fail=1; }

# Wait for a fresh deploy to answer.
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/login") && [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] && ok "sign-in page is up" || bad "/login returned $code"

body=$(curl -s "$SITE/login")
grep -q "The Bass Agency CRM" <<<"$body" && ok "sign-in page is the CRM" || bad "sign-in page title not found"
grep -qi "supabase\.co" <<<"$body" && bad "sign-in page mentions the database address" || ok "no database address in the page"

loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$SITE/dashboard")
[[ "$loc" == "$SITE/login?next=%2Fdashboard" ]] && ok "protected pages send you to sign in" || bad "/dashboard did not redirect to sign-in ($loc)"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "next-action: smoke-test" -H "content-type: text/plain" --data "x" "$SITE/contacts")
[ "$code" = "401" ] && ok "actions refuse signed-out callers (401)" || bad "unauthenticated action returned $code (expected 401)"

headers=$(curl -sI "$SITE/login" | tr -d '\r')
for h in "content-security-policy: .*worker-src 'self'" "strict-transport-security: max-age=" "x-frame-options: DENY" \
         "x-content-type-options: nosniff" "referrer-policy: no-referrer" "cache-control: private, no-store"; do
  grep -qiE "^$h" <<<"$headers" && ok "header ${h%%:*}" || bad "missing or wrong header: ${h%%:*}"
done

check_file() { # path, expected content type fragment, expected text (optional)
  local res code type
  code=$(curl -s -o /tmp/smoke.$$ -w '%{http_code} %{content_type}' "$SITE$1")
  type="${code#* }"; code="${code%% *}"
  if [ "$code" != "200" ]; then bad "$1 returned $code"; return; fi
  [[ "$type" == *"$2"* ]] || { bad "$1 has content type $type"; return; }
  if [ -n "${3:-}" ] && ! grep -q "$3" /tmp/smoke.$$; then bad "$1 does not contain $3"; return; fi
  ok "$1"
}
check_file /manifest.webmanifest "json" "Bass CRM"
check_file /sw.js "javascript" "bass-crm-static"
check_file /offline.html "text/html" "You're offline"
check_file /icons/icon-192.png "image/png"
check_file /icons/apple-touch-icon.png "image/png"
rm -f /tmp/smoke.$$

if [ "$fail" -ne 0 ]; then echo "✗ Smoke test FAILED for $SITE"; exit 1; fi
echo "✓ Smoke test passed for $SITE"
