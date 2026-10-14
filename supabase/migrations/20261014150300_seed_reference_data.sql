-- Reference data required in every environment (production included):
-- product lines, pipeline stages (spec §9), and default automation rules (spec §10).
-- Must stay in sync with src/lib/pipelines.ts — tests/db/reference-data.test.ts checks this.

insert into public.product_lines (code, name, sort_order) values
  ('auto', 'Auto', 1),
  ('home', 'Home', 2),
  ('commercial', 'Commercial', 3),
  ('life', 'Life', 4);

insert into public.pipeline_stages (product_line, code, name, position, kind) values
  ('auto', 'new_lead', 'New Lead', 1, 'active'),
  ('auto', 'contacted', 'Contacted', 2, 'active'),
  ('auto', 'info_needed', 'Info Needed', 3, 'active'),
  ('auto', 'quoted', 'Quoted', 4, 'active'),
  ('auto', 'follow_up', 'Follow Up', 5, 'active'),
  ('auto', 'bound', 'Bound', 6, 'won'),
  ('auto', 'lost', 'Lost', 7, 'lost'),

  ('home', 'new_lead', 'New Lead', 1, 'active'),
  ('home', 'contacted', 'Contacted', 2, 'active'),
  ('home', 'property_info_needed', 'Property Info Needed', 3, 'active'),
  ('home', 'quoted', 'Quoted', 4, 'active'),
  ('home', 'follow_up', 'Follow Up', 5, 'active'),
  ('home', 'bound', 'Bound', 6, 'won'),
  ('home', 'lost', 'Lost', 7, 'lost'),

  ('commercial', 'new_lead', 'New Lead', 1, 'active'),
  ('commercial', 'discovery', 'Discovery', 2, 'active'),
  ('commercial', 'info_needed', 'Info Needed', 3, 'active'),
  ('commercial', 'marketing_quoting', 'Marketing or Quoting', 4, 'active'),
  ('commercial', 'proposal_presented', 'Proposal Presented', 5, 'active'),
  ('commercial', 'follow_up', 'Follow Up', 6, 'active'),
  ('commercial', 'bound', 'Bound', 7, 'won'),
  ('commercial', 'lost', 'Lost', 8, 'lost'),

  ('life', 'new_lead', 'New Lead', 1, 'active'),
  ('life', 'contacted', 'Contacted', 2, 'active'),
  ('life', 'appointment_set', 'Appointment Set', 3, 'active'),
  ('life', 'needs_review', 'Needs Review', 4, 'active'),
  ('life', 'application_process', 'Application Process', 5, 'active'),
  ('life', 'decision_pending', 'Decision Pending', 6, 'active'),
  ('life', 'placed', 'Placed', 7, 'won'),
  ('life', 'lost', 'Lost', 8, 'lost');

-- Default follow-up rules, inserted for each new profile. These are defaults the owner can
-- edit or disable (Settings, Phase 6). Rules are stored only; nothing executes them until
-- Phase 6.
create function crm_private.create_default_automation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automation_rules
    (owner_id, rule_key, name, trigger_event, action, anchor, offset_days, day_count,
     task_title_template, task_priority, config)
  values
    (new.id, 'new_lead_initial_contact', 'New lead: make initial contact today',
     'opportunity_created', 'create_task', 'event_date', 0, 'calendar',
     'Make initial contact', 'high', '{}'),
    (new.id, 'contacted_no_quote_follow_up', 'Contacted without a quote: follow up in 2 business days',
     'initial_contact_no_quote', 'create_task', 'event_date', 2, 'business',
     'Follow up after initial contact', 'normal', '{}'),
    (new.id, 'quote_sent_follow_up', 'Quote sent: follow up in 3 days',
     'quote_sent', 'create_task', 'event_date', 3, 'calendar',
     'Follow up on quote', 'high', '{}'),
    (new.id, 'requested_follow_up', 'Prospect asked for a specific follow-up date',
     'follow_up_requested', 'create_task', 'requested_date', 0, 'calendar',
     'Follow up as requested', 'normal', '{}'),
    (new.id, 'no_response_follow_up', 'No response after follow-up: try again in 5 days',
     'no_response', 'create_task', 'event_date', 5, 'calendar',
     'Follow up again (no response)', 'normal', '{"confirm_before_creating": true}'),
    (new.id, 'won_close_prospecting', 'Won: close open prospecting tasks',
     'opportunity_won', 'close_prospecting_tasks', 'event_date', 0, 'calendar',
     null, 'normal', '{}'),
    (new.id, 'won_onboarding_checklist', 'Won: create onboarding checklist',
     'opportunity_won', 'create_checklist', 'event_date', 0, 'calendar',
     'Onboarding', 'normal',
     '{"items": ["Thank the client", "Confirm policy documents were received", "Review other coverage needs", "Ask for referrals"]}'),
    (new.id, 'lost_close_prospecting', 'Lost: close open prospecting tasks',
     'opportunity_lost', 'close_prospecting_tasks', 'event_date', 0, 'calendar',
     null, 'normal', '{}'),
    (new.id, 'renewal_review', 'Renewal review 60 days before renewal',
     'renewal_date_known', 'create_task', 'renewal_date', -60, 'calendar',
     'Renewal review', 'normal', '{}'),
    (new.id, 'reopened_restart', 'Reopened: start a new follow-up sequence',
     'opportunity_reopened', 'create_task', 'event_date', 0, 'calendar',
     'Re-engage reopened opportunity', 'normal', '{}');
  return new;
end;
$$;

revoke all on function crm_private.create_default_automation_rules() from public, anon, authenticated;

create trigger profiles_default_automation_rules after insert on public.profiles
  for each row execute function crm_private.create_default_automation_rules();
