import { removeContactDetail } from "@/app/(app)/contacts/details-actions";
import { RELATIONSHIP_LABELS, type HouseholdMember, type Vehicle } from "@/lib/contacts/details";
import { HouseholdMemberForm, VehicleForm } from "./detail-forms";

const REMOVE = "min-h-11 rounded-md px-3 text-sm underline";

function RemoveButton({ contactId, id, table, label }: { contactId: string; id: string; table: string; label: string }) {
  return (
    <form action={removeContactDetail}>
      <input type="hidden" name="contact_id" value={contactId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="table" value={table} />
      <button type="submit" className={REMOVE} aria-label={`Remove ${label}`}>Remove</button>
    </form>
  );
}

/** Household / other drivers: names and relationship only (Phase 14). */
export function HouseholdSection({ contactId, members, editable }: { contactId: string; members: HouseholdMember[]; editable: boolean }) {
  return (
    <section id="household" aria-labelledby="household-heading" className="flex flex-col gap-2">
      <h2 id="household-heading" className="text-lg font-semibold">Household / other drivers</h2>
      {members.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-400">None recorded.</p> : (
        <ul aria-label="Household members" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {members.map((m) => {
            const name = [m.first_name, m.last_name].filter(Boolean).join(" ");
            return (
              <li key={m.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{name}</span> <span className="text-sm text-slate-600 dark:text-slate-400">· {RELATIONSHIP_LABELS[m.relationship]}</span></span>
                  {editable ? <RemoveButton contactId={contactId} id={m.id} table="household_members" label={name} /> : null}
                </div>
                {editable ? (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm underline">Edit {name}</summary>
                    <HouseholdMemberForm contactId={contactId} member={m} />
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editable ? (
        <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Add a person</summary>
          <p className="mb-2 text-xs text-slate-500">Names only. Never record dates of birth or driver&apos;s license numbers.</p>
          <HouseholdMemberForm contactId={contactId} />
        </details>
      ) : null}
    </section>
  );
}

/** Vehicles: year, make, model only (Phase 14). */
export function VehiclesSection({ contactId, vehicles, editable }: { contactId: string; vehicles: Vehicle[]; editable: boolean }) {
  return (
    <section id="vehicles" aria-labelledby="vehicles-heading" className="flex flex-col gap-2">
      <h2 id="vehicles-heading" className="text-lg font-semibold">Vehicles</h2>
      {vehicles.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-400">None recorded.</p> : (
        <ul aria-label="Vehicles" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {vehicles.map((v) => {
            const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
            return (
              <li key={v.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{name}</span>
                  {editable ? <RemoveButton contactId={contactId} id={v.id} table="vehicles" label={name} /> : null}
                </div>
                {editable ? (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm underline">Edit {name}</summary>
                    <VehicleForm contactId={contactId} vehicle={v} />
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editable ? (
        <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Add a vehicle</summary>
          <p className="mb-2 text-xs text-slate-500">Year, make and model only (no VIN).</p>
          <VehicleForm contactId={contactId} />
        </details>
      ) : null}
    </section>
  );
}
