import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/tasks/profile-form";
import { requireFullSession } from "@/lib/auth/require";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Settings · The Bass Agency CRM" };

export default async function SettingsPage() {
  const { supabase, userId, email } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-medium">Signed in as</dt>
        <dd className="break-all">{email}</dd>
        <dt className="font-medium">Two-step sign-in</dt>
        <dd>On (required)</dd>
        <dt className="font-medium">Time zone</dt>
        <dd>{profile.time_zone.replace("_", " ")}</dd>
      </dl>
      <section aria-labelledby="messages-heading" className="flex flex-col gap-2">
        <h2 id="messages-heading" className="text-lg font-semibold">Review and referral messages</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Used to fill in the messages on Google review and referral request tasks.</p>
        <ProfileForm displayName={profile.display_name} reviewUrl={profile.google_review_url} />
      </section>
      <Link href="/reset-password" className="min-h-11 py-2 underline">Change password</Link>
      <p className="text-sm text-slate-500">Automation rules arrive in Phase 6.</p>
    </section>
  );
}
