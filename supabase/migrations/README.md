# supabase/migrations/

SQL migrations, applied in filename order (see `docs/data-model.md`).

| File | Contents |
|---|---|
| `20261014150000_core_schema.sql` | Enums, tables, constraints, indexes, triggers |
| `20261014150100_audit_log.sql` | Append-only audit log and its triggers |
| `20261014150200_row_level_security.sql` | RLS, grants, policies |
| `20261014150300_seed_reference_data.sql` | Product lines, pipeline stages, default automation rules |

Later migrations (Phases 2–27) are described in `docs/data-model.md` and DECISIONS.md; for
example `20261105120000_focus_events.sql` and `20261105120100_focus.sql` are ProducrIQ Focus
(Phase 27, ADR-045).

Never edit a migration after it has been applied to production; add a new one.
