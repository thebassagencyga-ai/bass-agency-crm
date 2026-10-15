"use client";

import { saveCrossSellRule } from "@/app/(app)/settings/actions";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import { RULE_CONTACT_TYPE_LABELS, type CrossSellRule } from "@/lib/cross-sell/types";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES } from "@/lib/pipelines";

/** Edit a cross-sell rule, or add one (rule undefined). Field ids are unique per form. */
export function CrossSellRuleForm({ rule }: { rule?: CrossSellRule }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveCrossSellRule);
  const err = state.fieldErrors ?? {};
  const prefix = rule ? `xs-${rule.rule_key}` : "xs-new";
  const fid = (name: string) => `${prefix}-${name}`;
  // After "Rule added." the form starts empty again; after an error it keeps what was typed.
  const echoed = state.values;
  const held = new Set(echoed ? (echoed.has_any_lines ?? "").split(",").filter(Boolean) : (rule?.has_any_lines ?? []));
  const v = (name: string, fallback: string) => echoed?.[name] ?? fallback;
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate key={rule ? undefined : state.message}>
      <FormAlert state={state} />
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input type="checkbox" name="enabled" defaultChecked={echoed ? echoed.enabled === "on" : (rule?.enabled ?? true)} className="h-5 w-5" />
        Turned on
      </label>
      <Field label="Name" name="name" id={fid("name")} defaultValue={v("name", rule?.name ?? "")} error={err.name} maxLength={100} />
      <fieldset className="flex flex-col gap-2" aria-describedby={err.has_any_lines ? fid("has-error") : undefined}>
        <legend className="mb-1 text-sm font-medium">Client has a policy in any of</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRODUCT_LINES.map((l) => (
            <label key={l} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="has_any_lines" value={l} defaultChecked={held.has(l)} className="h-5 w-5" />
              {PRODUCT_LINE_NAMES[l]}
            </label>
          ))}
        </div>
        {err.has_any_lines ? <p id={fid("has-error")} className="text-sm text-red-700 dark:text-red-400">{err.has_any_lines}</p> : null}
      </fieldset>
      <SelectField
        label="…but nothing in (suggest this line)" name="lacks_line" id={fid("lacks_line")} required
        options={PRODUCT_LINES.map((l) => ({ value: l, label: PRODUCT_LINE_NAMES[l] }))}
        defaultValue={v("lacks_line", rule?.lacks_line ?? "life")} error={err.lacks_line}
      />
      <SelectField
        label="Applies to" name="contact_type" id={fid("contact_type")} required
        options={(["any", "individual", "business"] as const).map((t) => ({ value: t, label: RULE_CONTACT_TYPE_LABELS[t] }))}
        defaultValue={v("contact_type", rule?.contact_type ?? "any")}
      />
      <TextAreaField
        label="Reason shown with the prompt" name="reason" id={fid("reason")} maxLength={300}
        defaultValue={v("reason", rule?.reason ?? "")} error={err.reason}
      />
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>{rule ? "Save rule" : "Add rule"}</SubmitButton>
      </div>
    </form>
  );
}
