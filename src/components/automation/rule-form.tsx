"use client";

import { updateRule } from "@/app/(app)/settings/actions";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import type { Rule } from "@/lib/automation/types";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "@/lib/tasks/types";

const CHECK = "h-5 w-5";

export function RuleForm({ rule }: { rule: Rule }) {
  const { state, formAction, pending, onSubmit } = useActionForm(updateRule);
  const err = state.fieldErrors ?? {};
  const v = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const isTask = rule.action === "create_task";
  // Fifteen of these forms share the page, so every field needs its own id.
  const fid = (name: string) => `${rule.rule_key}-${name}`;
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={rule.id} />
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input type="checkbox" name="enabled" defaultChecked={state.values ? state.values.enabled === "on" : rule.enabled} className={CHECK} />
        Turned on
      </label>

      {isTask ? (
        <>
          <Field
            label="Task title" name="task_title_template" id={fid("task_title_template")} defaultValue={v("task_title_template", rule.task_title_template ?? "")} error={err.task_title_template} maxLength={200}
            hint={rule.rule_key === "referrer_thank_you" ? "Use {referrer_name} and {referred_name}. A personal call or note only: never offer anything of value." : undefined}
          />
          {rule.anchor !== "requested_date" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field
                label={rule.anchor === "renewal_date" ? "Days before renewal" : "Days later"}
                name="days" id={fid("days")} inputMode="numeric" defaultValue={v("days", String(Math.abs(rule.offset_days)))} error={err.days}
              />
              {rule.anchor === "event_date" ? (
                <SelectField label="Count" name="day_count" id={fid("day_count")} required options={[{ value: "calendar", label: "Calendar days" }, { value: "business", label: "Business days (Mon–Fri)" }]} defaultValue={v("day_count", rule.day_count)} />
              ) : null}
            </div>
          ) : null}
          <SelectField label="Priority" name="task_priority" id={fid("task_priority")} required options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} defaultValue={v("task_priority", rule.task_priority)} />
          {rule.completion_window_days > 0 || rule.cooldown_days ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Days to complete" name="completion_window_days" id={fid("completion_window_days")} inputMode="numeric" defaultValue={v("completion_window_days", String(rule.completion_window_days))} error={err.completion_window_days} />
              {rule.cooldown_days ? (
                <Field label="Don't repeat within (days)" name="cooldown_days" id={fid("cooldown_days")} inputMode="numeric" defaultValue={v("cooldown_days", String(rule.cooldown_days))} error={err.cooldown_days} />
              ) : null}
            </div>
          ) : null}
          {rule.rule_key === "no_response_follow_up" ? (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" name="confirm_before_creating" defaultChecked={state.values ? state.values.confirm_before_creating === "on" : Boolean(rule.config.confirm_before_creating)} className={CHECK} />
              Ask me before creating this follow-up
            </label>
          ) : null}
          {typeof rule.config.message_template === "string" ? (
            <TextAreaField
              label="Message" name="message_template" id={fid("message_template")} defaultValue={v("message_template", rule.config.message_template)} error={err.message_template} maxLength={1000}
              hint="Use {first_name}, {agent_name} and {review_link}. Ask every client the same way and never offer anything in return."
            />
          ) : null}
        </>
      ) : null}

      {rule.action === "create_checklist" ? (
        <TextAreaField label="Checklist items (one per line)" name="items" id={fid("items")} defaultValue={v("items", (rule.config.items ?? []).join("\n"))} error={err.items} maxLength={2200} />
      ) : null}

      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>Save rule</SubmitButton>
      </div>
    </form>
  );
}
