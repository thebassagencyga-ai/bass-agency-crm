import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Contacts · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Contacts" phase={3} summary="Individual and business contacts with search, filters and a detail page for each." />;
}
