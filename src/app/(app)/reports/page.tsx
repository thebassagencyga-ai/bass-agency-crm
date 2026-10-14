import type { Metadata } from "next";
import { Placeholder } from "@/components/placeholder";

export const metadata: Metadata = { title: "Reports · The Bass Agency CRM" };

export default function Page() {
  return <Placeholder title="Reports" phase={9} summary="Leads, quotes, conversions, follow-up activity, referrals and reviews." />;
}
