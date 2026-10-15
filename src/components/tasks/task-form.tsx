"use client";

import Link from "next/link";
import { createTask, updateTask } from "@/app/(app)/tasks/actions";
import { ReferrerPicker } from "@/components/contacts/referrer-picker";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import { CATEGORY_LABELS, PRIORITY_LABELS, TASK_CATEGORIES, TASK_PRIORITIES, type Task } from "@/lib/tasks/types";

type OpportunityOption = { id: string; label: string };
type Props = {
  task?: Task;
  /** Known contact (adding from a contact page, or editing). Null: pick one in the form. */
  contact: { id: string; name: string } | null;
  opportunities: OpportunityOption[];
  defaultDueDate: string;
};

export function TaskForm({ task, contact, opportunities, defaultDueDate }: Props) {
  const { state, formAction, pending, onSubmit } = useActionForm(task ? updateTask : createTask);
  const v = (name: string): string | undefined => {
    if (state.values && name in state.values) return state.values[name];
    const value = task ? (task as unknown as Record<string, unknown>)[name] : undefined;
    return value === null || value === undefined ? undefined : String(value);
  };
  const err = state.fieldErrors ?? {};
  const cancelHref = task ? `/tasks/${task.id}` : contact ? `/contacts/${contact.id}` : "/tasks";

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      {contact ? (
        <>
          {task ? null : <input type="hidden" name="contact_id" value={contact.id} />}
          <p className="text-sm">For <span className="font-medium">{contact.name}</span></p>
        </>
      ) : (
        <ReferrerPicker
          initial={null} excludeId={null} error={err.contact_id}
          name="contact_id" searchName="contact_search" label="Contact" optional={false}
          hint="Every task belongs to a contact: type 2 or more letters, then tap the person in the list."
        />
      )}
      <Field label="What needs doing" name="title" defaultValue={v("title")} error={err.title} maxLength={200} />
      <Field label="Due date" name="due_date" type="date" defaultValue={v("due_date") ?? defaultDueDate} error={err.due_date} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Priority" name="priority" required options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} defaultValue={v("priority") ?? "normal"} error={err.priority} />
        <SelectField label="Type" name="category" required options={TASK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} defaultValue={v("category") ?? "other"} error={err.category} />
      </div>
      {opportunities.length > 0 ? (
        <SelectField label="Opportunity" name="opportunity_id" options={opportunities.map((o) => ({ value: o.id, label: o.label }))} defaultValue={v("opportunity_id")} error={err.opportunity_id} placeholder="None" />
      ) : null}
      <details open={Boolean(task?.description || task?.start_date || err.start_date || err.description)} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">More details</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field label="Don't show before" name="start_date" type="date" required={false} defaultValue={v("start_date")} error={err.start_date} hint="Keeps the task off Today until this date." />
          <TextAreaField label="Details" name="description" defaultValue={v("description")} error={err.description} maxLength={2000} />
        </div>
      </details>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Link href={cancelHref} className="min-h-11 px-3 py-2 text-center underline">Cancel</Link>
        <div className="sm:ml-auto sm:w-48">
          <SubmitButton pendingText="Saving…" pending={pending}>{task ? "Save changes" : "Add task"}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
