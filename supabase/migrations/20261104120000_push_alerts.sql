-- Phase 26 (workflow audit Step 2, ADR-044): alerts on the agent's devices when a quote request
-- arrives through the public form (Web Push; no customer details in the alert).
--
-- push_subscriptions   each device an agent turned alerts on for (browser push subscription)
-- crm_private.push_alerts  the outbox: one row per submission owed an alert, claimed once
-- claim_push_alerts    called by the app after a submission: hands out the devices to alert,
--                      once per owed alert, only to a caller holding the app's push key
--
-- The submission never depends on the alert: submit_intake only adds an outbox row in the same
-- transaction; the app sends afterwards, in the background. A device's dispatch_hash is the
-- SHA-256 of a proof derived from the app's push key (src/lib/push/webpush.ts dispatchProof),
-- stored when the agent turns alerts on; the key itself lives only in the hosting provider's
-- secret store.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  endpoint text not null check (char_length(endpoint) between 10 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  device_label text not null default 'This device' check (char_length(device_label) between 1 and 60),
  dispatch_hash bytea not null check (length(dispatch_hash) = 32),
  disabled_at timestamptz,
  -- Set by claim_push_alerts when an alert is handed out for this device (shown in Settings).
  last_alert_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_owner_endpoint_key unique (owner_id, endpoint)
);
comment on table public.push_subscriptions is
  'Phase 26: devices an agent turned new-lead alerts on for. Turned off (disabled_at), never deleted.';

create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function crm_private.touch_row();
create trigger push_subscriptions_keep_owner before update on public.push_subscriptions
  for each row execute function crm_private.keep_owner();
create trigger push_subscriptions_audit after insert or update or delete on public.push_subscriptions
  for each row execute function crm_private.write_audit_log();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth, device_label, dispatch_hash) on public.push_subscriptions to authenticated;
grant update (p256dh, auth, device_label, dispatch_hash, disabled_at) on public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy push_subscriptions_require_mfa on public.push_subscriptions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- The outbox, private to the database (no API access at all).
create table crm_private.push_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid not null unique references public.intake_submissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index push_alerts_unclaimed_idx on crm_private.push_alerts (owner_id) where claimed_at is null;
comment on table crm_private.push_alerts is
  'Phase 26: alerts owed for quote requests; claimed once by claim_push_alerts.';

-- Hands out, once, the devices to alert for every unclaimed alert of the agents whose devices
-- were registered with this proof. Alerts more than a day old are claimed but not sent (stale).
-- Returns endpoint and keys only: no customer details. Anonymous (the public form's server
-- action calls it), SECURITY DEFINER with a pinned search_path, closed to signed-in users.
create function public.claim_push_alerts(p_proof text)
returns table (subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  h bytea;
begin
  if p_proof is null or p_proof !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;
  h := sha256(convert_to(p_proof, 'UTF8'));
  return query
  with owners as (
    select distinct s.owner_id from public.push_subscriptions s where s.dispatch_hash = h and s.disabled_at is null
  ),
  claimed as (
    update crm_private.push_alerts a set claimed_at = now()
    where a.claimed_at is null and a.owner_id in (select o.owner_id from owners o)
    returning a.owner_id, a.created_at
  ),
  handed as (
    update public.push_subscriptions s set last_alert_at = now()
    where s.disabled_at is null and s.dispatch_hash = h
      and s.owner_id in (select c.owner_id from claimed c where c.created_at > now() - interval '1 day')
    returning s.id, s.endpoint, s.p256dh, s.auth
  )
  select x.id, x.endpoint, x.p256dh, x.auth from handed x;
end;
$$;
comment on function public.claim_push_alerts(text) is
  'Phase 26: devices to alert for owed new-quote-request alerts; once each; needs the push key proof.';
revoke all on function public.claim_push_alerts(text) from public, authenticated;
grant execute on function public.claim_push_alerts(text) to anon;

-- The public form now owes an alert when the owner has alerts on (otherwise unchanged).
create or replace function public.submit_intake(p_token text, p_form jsonb, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
  f jsonb;
  last_hour integer;
  last_day integer;
  submission uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  select * into link from public.intake_links l where l.token = p_token and l.enabled for update;
  if not found then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  if p_consent is not true then
    raise exception 'consent' using errcode = '22023';
  end if;
  select count(*) filter (where s.submitted_at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
  from public.intake_submissions s
  where s.link_id = link.id and s.submitted_at > now() - interval '1 day';
  if last_hour >= 10 or last_day >= 50 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  f := crm_engine.intake_clean(p_form);
  insert into public.intake_submissions (owner_id, link_id, first_name, last_name, email, phone,
    address_line1, city, state, postal_code, preferred_contact_method, best_time, lines, current_coverage,
    household, vehicles, heard_about, referred_by_name, consent_at, consent_version)
  values (link.owner_id, link.id, f ->> 'first_name', f ->> 'last_name', f ->> 'email', f ->> 'phone',
    f ->> 'address_line1', f ->> 'city', f ->> 'state',
    f ->> 'postal_code', (f ->> 'preferred_contact_method')::public.contact_method, f ->> 'best_time',
    array(select jsonb_array_elements_text(f -> 'lines')), f -> 'current_coverage',
    f -> 'household', f -> 'vehicles',
    f ->> 'heard_about', f ->> 'referred_by_name', now(), 'v1')
  returning id into submission;

  -- Phase 26: one alert owed to the owner, if they have alerts on (sent after this commits).
  insert into crm_private.push_alerts (owner_id, submission_id)
  select link.owner_id, submission
  where exists (select 1 from public.push_subscriptions p where p.owner_id = link.owner_id and p.disabled_at is null);
end;
$$;
