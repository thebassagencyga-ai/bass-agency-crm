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
      <legend className="text-sm font-medium">Tags <span className="font-normal text-muted">(optional)</span></legend>
      {all.length === 0 ? (
        <p className="text-sm text-muted">
          No tags yet. <Link href="/settings#tags" className="underline text-link">Add tags in Settings</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {all.map((t, i) => (
            <label key={t}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-fg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
              <input id={`tag-${i}`} type="checkbox" name="tags" value={t} defaultChecked={on.has(t.toLowerCase())} className="h-4 w-4" />
              {t}
            </label>
          ))}
        </div>
      )}
      {all.length > 0 ? <p className="text-xs text-muted">Change the list in <Link href="/settings#tags" className="underline text-link">Settings → Tags</Link>.</p> : null}
      {error ? <p id="tags-error" className="text-sm text-bad">{error}</p> : null}
    </fieldset>
  );
}
