import { setTaskStatus } from "@/app/(app)/tasks/actions";
import type { TaskStatus } from "@/lib/tasks/types";

const BUTTON = "min-h-11 rounded-md px-4 font-medium";

/**
 * Complete / reopen / cancel. Plain forms: they work before JavaScript loads. The compact
 * button's accessible name starts with its visible word, so voice control ("tap Done") works.
 */
export function TaskStatusButtons({ id, status, back, compact = false }: { id: string; status: TaskStatus; back?: string; compact?: boolean }) {
  const form = (next: TaskStatus, label: string, style: string, accessibleName?: string) => (
    <form action={setTaskStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <button type="submit" aria-label={accessibleName} className={`${BUTTON} ${style}`}>{label}</button>
    </form>
  );
  if (status === "open") {
    return (
      <div className="flex flex-wrap gap-2">
        {form("completed", compact ? "Done" : "Mark complete", "bg-brand text-on-brand hover:bg-brand-hover", compact ? "Done – mark complete" : undefined)}
        {compact ? null : form("cancelled", "Cancel task", "border border-line-strong")}
      </div>
    );
  }
  return form("open", "Reopen", "border border-line-strong bg-card hover:bg-subtle");
}
