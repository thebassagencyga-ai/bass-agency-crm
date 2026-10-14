import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Renewals · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Renewals" phase={8} summary="Upcoming renewal reviews and cross-selling prompts." />;
}
