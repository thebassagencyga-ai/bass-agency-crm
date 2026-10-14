import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Dashboard · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Dashboard" phase={7} summary="Today's work: overdue and due-today tasks, open opportunities, recent activity and upcoming renewals." />;
}
