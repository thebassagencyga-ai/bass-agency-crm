// Shapes of task rows as read through the Data API (see supabase/migrations).
import type { ContactType } from "@/lib/contacts/types";
import type { ProductLine } from "@/lib/pipelines";

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export const TASK_CATEGORIES = ["prospecting", "onboarding", "renewal", "review_request", "referral_request", "other"] as const;
export const TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export const TASK_VIEWS = ["overdue", "today", "upcoming", "done"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskView = (typeof TASK_VIEWS)[number];

export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = { low: "Low", normal: "Normal", high: "High" };
export const CATEGORY_LABELS: Readonly<Record<TaskCategory, string>> = {
  prospecting: "Prospecting",
  onboarding: "Onboarding",
  renewal: "Renewal",
  review_request: "Google review request",
  referral_request: "Referral request",
  other: "Other",
};
export const VIEW_LABELS: Readonly<Record<TaskView, string>> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  done: "Completed",
};

export interface Task {
  id: string;
  contact_id: string;
  opportunity_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  start_date: string | null;
  priority: TaskPriority;
  category: TaskCategory;
  status: TaskStatus;
  completed_at: string | null;
  cancelled_at: string | null;
  origin: "manual" | "automation";
  automation_rule_id: string | null;
  due_date_overridden: boolean;
  created_at: string;
  updated_at: string;
}

/** Row returned by search_tasks: the task plus contact and product line. */
export interface TaskListRow extends Pick<Task, "id" | "contact_id" | "opportunity_id" | "title" | "description" | "due_date" | "start_date" | "priority" | "category" | "status" | "completed_at" | "cancelled_at" | "origin" | "created_at"> {
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string | null;
  product_line: ProductLine | null;
}
