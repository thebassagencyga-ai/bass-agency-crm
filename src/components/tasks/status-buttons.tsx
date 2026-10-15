import { setTaskStatus } from "@/app/(app)/tasks/actions";
import type { TaskStatus } from "@/lib/tasks/types";

const BUTTON = "min-h-11 rounded-md px-4 font-medium";

/** Complete / reopen / cancel. Plain forms: they work before JavaScript loads. */
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
        {form("completed", compact ? "Done" : "Mark complete", "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900", compact ? "Mark complete" : undefined)}
        {compact ? null : form("cancelled", "Cancel task", "border border-slate-400")}
      </div>
    );
  }
  return form("open", "Reopen", "border border-slate-900 dark:border-slate-100");
}
