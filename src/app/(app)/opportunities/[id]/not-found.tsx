import Link from "next/link";

export default function OpportunityNotFound() {
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">Opportunity not found</h1>
      <p className="text-muted">This opportunity doesn&apos;t exist or isn&apos;t yours.</p>
      <Link href="/opportunities" className="min-h-11 py-2 underline text-link">Back to opportunities</Link>
    </section>
  );
}
