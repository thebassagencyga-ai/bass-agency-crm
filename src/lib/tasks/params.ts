// Parses the task page's URL parameters; invalid values fall back to defaults.
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_VIEWS, type TaskCategory, type TaskPriority, type TaskView } from "./types";

export const TASKS_PAGE_SIZE = 50;

export interface TaskListParams {
  view: TaskView;
  line: ProductLine | null;
  priority: TaskPriority | null;
  category: TaskCategory | null;
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function parseTaskListParams(raw: Raw): TaskListParams {
  const page = Number.parseInt(first(raw.page), 10);
  return {
    view: oneOf(first(raw.view), TASK_VIEWS) ?? "today",
    line: oneOf(first(raw.line), PRODUCT_LINES),
    priority: oneOf(first(raw.priority), TASK_PRIORITIES),
    category: oneOf(first(raw.category), TASK_CATEGORIES),
    page: Number.isFinite(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}
