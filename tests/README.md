# tests/

Populated from Phase 1. Planned layout:
- `unit/` — pure business logic (dates, rules, metrics) — Vitest
- `db/` — schema, constraint and RLS tests against a local database
- `integration/` — server actions / API against the local Supabase stack
- `e2e/` — Playwright journeys (Phase 11)

Fixtures must be fictional (`@example.com`, 555-01xx numbers). Never use real client data.
