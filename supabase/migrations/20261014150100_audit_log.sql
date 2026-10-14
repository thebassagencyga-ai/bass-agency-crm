-- Audit trail for important business record changes (ADR-009).
-- Rows are written only by trigger. Application users can read their own entries and
-- cannot insert, update or delete them.

create table public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  -- Who made the change (auth.uid()); null for migrations or maintenance run without a user.
  actor_id uuid,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  -- For updates, only the columns that changed (updated_at excluded).
  old_values jsonb,
  new_values jsonb,
  occurred_at timestamptz not null default now()
);
comment on table public.audit_log is 'Append-only change history written by triggers.';

create index audit_log_record_idx on public.audit_log (table_name, record_id, occurred_at desc);
create index audit_log_owner_recent_idx on public.audit_log (owner_id, occurred_at desc);

-- SECURITY DEFINER so the trigger can append to audit_log, which application roles cannot
-- write to. search_path is empty and every reference is schema-qualified.
create function crm_private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  changed_old jsonb := '{}'::jsonb;
  changed_new jsonb := '{}'::jsonb;
  col text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (owner_id, actor_id, table_name, record_id, action, new_values)
    values (new.owner_id, auth.uid(), tg_table_name, new.id, 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    for col in select jsonb_object_keys(new_row) loop
      if col <> 'updated_at' and (new_row -> col) is distinct from (old_row -> col) then
        changed_old := changed_old || jsonb_build_object(col, old_row -> col);
        changed_new := changed_new || jsonb_build_object(col, new_row -> col);
      end if;
    end loop;
    if changed_new <> '{}'::jsonb then
      insert into public.audit_log (owner_id, actor_id, table_name, record_id, action, old_values, new_values)
      values (new.owner_id, auth.uid(), tg_table_name, new.id, 'update', changed_old, changed_new);
    end if;
    return new;
  else
    insert into public.audit_log (owner_id, actor_id, table_name, record_id, action, old_values)
    values (old.owner_id, auth.uid(), tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
end;
$$;

create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function crm_private.write_audit_log();
create trigger opportunities_audit after insert or update or delete on public.opportunities
  for each row execute function crm_private.write_audit_log();
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function crm_private.write_audit_log();
create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function crm_private.write_audit_log();
create trigger automation_rules_audit after insert or update or delete on public.automation_rules
  for each row execute function crm_private.write_audit_log();
