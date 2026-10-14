import Link from "next/link";

export default function ContactNotFound() {
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">Contact not found</h1>
      <p className="text-slate-600 dark:text-slate-400">This contact doesn&apos;t exist or isn&apos;t yours.</p>
      <Link href="/contacts" className="min-h-11 py-2 underline">Back to contacts</Link>
    </section>
  );
}
