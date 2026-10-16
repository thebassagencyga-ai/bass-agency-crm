import Link from "next/link";

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100 dark:border-slate-600 dark:has-[:checked]:border-slate-100 dark:has-[:checked]:bg-slate-800";

/** "Add as a new contact" or "Add to <existing contact>" (possible duplicates). */
export function TargetChoice({ duplicates, legend }: { duplicates: { id: string; label: string; detail: string }[]; legend: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {duplicates.length > 0 ? (
        <p className="text-sm text-amber-900 dark:text-amber-100">You may already have this person (same email or phone).</p>
      ) : null}
      <label className={CHOICE}>
        <input type="radio" name="target" value="new" defaultChecked />
        Add as a new contact
      </label>
      {duplicates.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-x-3">
          <label className={`${CHOICE} flex-1`}>
            <input type="radio" name="target" value={d.id} />
            <span>
              Add to {d.label}
              {d.detail ? <span className="text-sm text-slate-600 dark:text-slate-400"> — {d.detail}</span> : null}
            </span>
          </label>
          <Link href={`/contacts/${d.id}`} target="_blank" className="inline-flex min-h-11 min-w-11 items-center text-sm underline">View</Link>
        </div>
      ))}
    </fieldset>
  );
}
