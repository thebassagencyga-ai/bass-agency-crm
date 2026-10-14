# supabase/migrations/

SQL migrations, applied in filename order (see `docs/data-model.md`).

| File | Contents |
|---|---|
| `20261014150000_core_schema.sql` | Enums, tables, constraints, indexes, triggers |
| `20261014150100_audit_log.sql` | Append-only audit log and its triggers |
| `20261014150200_row_level_security.sql` | RLS, grants, policies |
| `20261014150300_seed_reference_data.sql` | Product lines, pipeline stages, default automation rules |

Never edit a migration after it has been applied to production; add a new one.
