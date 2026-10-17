import Link from "next/link";

/**
 * Tags as tick boxes from the agent's list (Phase 20, ADR-036). Tags already on the contact but
 * no longer on the list are shown too, so saving never drops them by surprise.
 */
export function TagPicker({ options, checked, error }: { options: readonly string[]; checked: readonly string[]; error?: string }) {
  const on = new Set(checked.map((t) => t.toLowerCase()));
  const listed = new Set(options.map((t) => t.toLowerCase()));
  const extra = checked.filter((t) => !listed.has(t.toLowerCase()));
  const all = [...options, ...extra];
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? "tags-error" : undefined}>
      <legend className="text-sm font-medium">Tags <span className="font-normal text-slate-500">(optional)</span></legend>
      {all.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No tags yet. <Link href="/settings#tags" className="underline">Add tags in Settings</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {all.map((t, i) => (
            <label key={t}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-300 px-3 has-[:checked]:border-sky-700 has-[:checked]:bg-sky-100 has-[:checked]:text-sky-900 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-600 dark:border-slate-600 dark:has-[:checked]:bg-sky-900 dark:has-[:checked]:text-sky-100">
              <input id={`tag-${i}`} type="checkbox" name="tags" value={t} defaultChecked={on.has(t.toLowerCase())} className="h-4 w-4" />
              {t}
            </label>
          ))}
        </div>
      )}
      {all.length > 0 ? <p className="text-xs text-slate-500">Change the list in <Link href="/settings#tags" className="underline">Settings → Tags</Link>.</p> : null}
      {error ? <p id="tags-error" className="text-sm text-red-700">{error}</p> : null}
    </fieldset>
  );
}
