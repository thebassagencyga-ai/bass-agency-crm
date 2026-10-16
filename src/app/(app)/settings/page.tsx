import type { Metadata } from "next";
import Link from "next/link";
import { RuleForm } from "@/components/automation/rule-form";
import { CrossSellRuleForm } from "@/components/cross-sell/rule-form";
import { describeCrossSellRule } from "@/lib/cross-sell";
import { getCrossSellRules } from "@/lib/cross-sell/data";
import { ProfileForm } from "@/components/tasks/profile-form";
import { describeRule } from "@/lib/automation";
import { getRules } from "@/lib/automation/data";
import { IntakeLinkPanel } from "@/components/intake/link-panel";
import { requireFullSession } from "@/lib/auth/require";
import { siteUrl } from "@/lib/env";
import { getIntakeLink } from "@/lib/intake/data";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Settings · The Bass Agency CRM" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId, email } = await requireFullSession();
  const [profile, rules, crossSell, intakeLink] = await Promise.all([
    getProfile(supabase, userId), getRules(supabase), getCrossSellRules(supabase), getIntakeLink(supabase),
  ]);
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
      <IntakeLinkPanel link={intakeLink} baseUrl={siteUrl()} notice={query.intake} />
      <section aria-labelledby="messages-heading" className="flex flex-col gap-2">
        <h2 id="messages-heading" className="text-lg font-semibold">Review and referral messages</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Used to fill in the messages on Google review and referral request tasks.</p>
        <ProfileForm displayName={profile.display_name} reviewUrl={profile.google_review_url} />
      </section>
      <section aria-labelledby="rules-heading" className="flex flex-col gap-2">
        <h2 id="rules-heading" className="text-lg font-semibold">Automatic follow-up tasks</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          These create and close tasks for you as opportunities move. Changing a rule affects new tasks only;
          dates you change on a task yourself are never overwritten.
        </p>
        <ul aria-label="Automation rules" className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li key={rule.id}>
              <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-1 py-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {rule.name}
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${rule.enabled ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{describeRule(rule)}</span>
                </summary>
                <div className="mt-3">
                  <RuleForm rule={rule} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="cross-sell-rules-heading" className="flex flex-col gap-2">
        <h2 id="cross-sell-rules-heading" className="text-lg font-semibold">Cross-sell reviews</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Suggest reviewing another line when a client has a policy in one line but nothing in the other. Only recorded
          policies count; a line with an open opportunity, or one lost in the last 12 months, is not suggested.
        </p>
        <ul aria-label="Cross-sell rules" className="flex flex-col gap-2">
          {crossSell.map((rule) => (
            <li key={rule.id}>
              <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-1 py-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {rule.name}
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${rule.enabled ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{describeCrossSellRule(rule)}</span>
                </summary>
                <div className="mt-3">
                  <CrossSellRuleForm rule={rule} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Add a cross-sell rule</summary>
          <div className="mt-3">
            <CrossSellRuleForm />
          </div>
        </details>
      </section>
      <Link href="/reset-password" className="min-h-11 py-2 underline">Change password</Link>
    </section>
  );
}
