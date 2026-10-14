import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Opportunities · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Opportunities" phase={4} summary="Auto, home, commercial and life pipelines as a board and a searchable table." />;
}
