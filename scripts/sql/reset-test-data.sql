-- ONE-TIME, BEFORE REAL CLIENT DATA ONLY (docs/go-live-checklist.md).
--
-- Removes the fictional test records of ONE CRM user so reports start clean: contacts,
-- opportunities, tasks, activities, renewal outcomes, cross-sell dismissals and their audit
-- history. Keeps the user's sign-in, profile, settings, automation rules and cross-sell rules.
-- The app itself never deletes anything; this is run by the owner in the Supabase SQL editor
-- (Dashboard → SQL Editor), after typing their own sign-in email below.
--
-- It refuses to run if the user has any contact that is not obviously fictional (an email not
-- ending in example.com/.test, or a phone number not in the 555-01xx range), so it cannot wipe
-- real clients by mistake. Everything happens in one transaction: all or nothing.

begin;

do $$
declare
  owner_email constant text := 'REPLACE-WITH-YOUR-SIGN-IN-EMAIL';
  uid uuid;
  real_looking integer;
begin
  select id into uid from auth.users where lower(email) = lower(owner_email);
  if uid is null then
    raise exception 'No user with email %. Type your sign-in email in the script first.', owner_email;
  end if;

  select count(*) into real_looking from public.contacts c
  where c.owner_id = uid
    and ((c.email is not null and c.email !~* '@(example\.(com|org|net)|[a-z0-9.-]+\.test)$')
      or (c.phone is not null and regexp_replace(c.phone, '\D', '', 'g') !~ '^1?55501\d\d$')
      or (c.alt_phone is not null and regexp_replace(c.alt_phone, '\D', '', 'g') !~ '^1?55501\d\d$'));
  if real_looking > 0 then
    raise exception 'Stopped: % contact(s) have a real-looking email or phone. Nothing was deleted.', real_looking;
  end if;

  delete from public.cross_sell_dismissals where owner_id = uid;
  delete from public.renewal_outcomes where owner_id = uid;
  delete from public.activities where owner_id = uid;
  delete from public.tasks where owner_id = uid;
  delete from public.opportunities where owner_id = uid;
  update public.contacts set referred_by_contact_id = null where owner_id = uid and referred_by_contact_id is not null;
  delete from public.contacts where owner_id = uid;
  delete from public.audit_log where owner_id = uid and table_name in
    ('contacts', 'opportunities', 'tasks', 'activities', 'renewal_outcomes', 'cross_sell_dismissals');
  raise notice 'Test records removed for %.', owner_email;
end $$;

commit;
