// Where an open task belongs relative to "today" (computed in the user's time zone).
// Mirrors search_tasks in supabase/migrations/20261018120000_task_views.sql.
import type { TaskStatus, TaskView } from "./types";

export function taskView(task: { status: TaskStatus; due_date: string }, today: string): TaskView {
  if (task.status !== "open") return "done";
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  return "upcoming";
}

/** True while a task's start date is still in the future (it is not part of today's work). */
export const notStartedYet = (task: { start_date: string | null }, today: string) => task.start_date !== null && task.start_date > today;
