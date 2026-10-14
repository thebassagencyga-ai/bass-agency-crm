# tests/

| Folder | What | Command |
|---|---|---|
| `unit/` | Pure business logic (no database) — Vitest | `npm test` |
| `db/` | Schema, constraints, RLS and audit tests against a disposable local database | `npm run test:db` |
| `integration/` | Server actions / API against the local Supabase stack | from Phase 2 |
| `e2e/` | Playwright journeys | Phase 11 |

## Database tests
- `db/global-setup.ts` creates a fresh database, applies `db/supabase-shim.sql` (a test-only
  stand-in for Supabase's `auth` schema and API roles) and every file in
  `supabase/migrations/`, then drops it after the run. Set `KEEP_TEST_DATABASE=1` to keep it.
- `db/helpers.ts` runs SQL the way Supabase's Data API does: in a transaction, as the `anon`
  or `authenticated` role, with JWT claims so `auth.uid()` returns the test user.
- `db/supabase-smoke.sql` runs in CI against Supabase's real Postgres image.

Fixtures must be fictional (`@example.com`, 555-01xx numbers). Never use real client data.
