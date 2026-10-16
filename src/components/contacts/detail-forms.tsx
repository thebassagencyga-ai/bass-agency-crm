"use client";

import { saveHouseholdMember, saveVehicle } from "@/app/(app)/contacts/details-actions";
import { Field, FormAlert, SelectField, SubmitButton, useActionForm } from "@/components/form";
import { HOUSEHOLD_RELATIONSHIPS, RELATIONSHIP_LABELS, type HouseholdMember, type Vehicle } from "@/lib/contacts/details";

const relationshipOptions = HOUSEHOLD_RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }));

/** Add or edit one household member (ids keep fields unique when several forms are on the page). */
export function HouseholdMemberForm({ contactId, member }: { contactId: string; member?: HouseholdMember }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveHouseholdMember);
  const p = member?.id ?? "new";
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="contact_id" value={contactId} />
      {member ? <input type="hidden" name="id" value={member.id} /> : null}
      <FormAlert state={state} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="First name" name="first_name" id={`hh-first-${p}`} defaultValue={member?.first_name} error={err.first_name} maxLength={100} />
        <Field label="Last name" name="last_name" id={`hh-last-${p}`} required={false} defaultValue={member?.last_name ?? undefined} error={err.last_name} maxLength={100} />
        <SelectField label="Relationship" name="relationship" id={`hh-rel-${p}`} options={relationshipOptions} defaultValue={member?.relationship ?? "spouse"} required />
      </div>
      <SubmitButton pendingText="Saving…" pending={pending}>{member ? "Save person" : "Add person"}</SubmitButton>
    </form>
  );
}

export function VehicleForm({ contactId, vehicle }: { contactId: string; vehicle?: Vehicle }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveVehicle);
  const p = vehicle?.id ?? "new";
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="contact_id" value={contactId} />
      {vehicle ? <input type="hidden" name="id" value={vehicle.id} /> : null}
      <FormAlert state={state} />
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Field label="Year" name="year" id={`veh-year-${p}`} inputMode="numeric" maxLength={4} defaultValue={vehicle ? String(vehicle.year) : undefined} error={err.year} />
        <Field label="Make" name="make" id={`veh-make-${p}`} defaultValue={vehicle?.make} error={err.make} maxLength={50} />
        <Field label="Model" name="model" id={`veh-model-${p}`} required={false} defaultValue={vehicle?.model ?? undefined} error={err.model} maxLength={50} />
      </div>
      <SubmitButton pendingText="Saving…" pending={pending}>{vehicle ? "Save vehicle" : "Add vehicle"}</SubmitButton>
    </form>
  );
}
