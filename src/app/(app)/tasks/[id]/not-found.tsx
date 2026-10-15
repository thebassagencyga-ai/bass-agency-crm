import Link from "next/link";

export default function TaskNotFound() {
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">Task not found</h1>
      <p className="text-slate-600 dark:text-slate-400">This task doesn&apos;t exist or isn&apos;t yours.</p>
      <Link href="/tasks" className="min-h-11 py-2 underline">Back to tasks</Link>
    </section>
  );
}
