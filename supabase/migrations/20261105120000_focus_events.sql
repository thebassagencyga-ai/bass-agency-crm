-- Phase 27 (ADR-045): the events of the three new automation rules. Added in their own
-- migration because a new enum value cannot be used in the transaction that adds it; the next
-- migration (20261105120100_focus.sql) uses them.

alter type public.automation_trigger add value if not exists 'nurture_started';
alter type public.automation_trigger add value if not exists 'current_policy_renewal_known';
alter type public.automation_trigger add value if not exists 'referral_received';
