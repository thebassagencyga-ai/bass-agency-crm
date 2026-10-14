import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Tasks · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Tasks" phase={5} summary="Overdue, due today, upcoming and completed tasks." />;
}
