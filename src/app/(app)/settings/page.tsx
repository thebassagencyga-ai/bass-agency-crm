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
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/import/export";
import { getProfile } from "@/lib/tasks/data";
import { knownTags } from "@/lib/contacts/data";
import { MAX_TAG_LENGTH } from "@/lib/contacts/tags";
import { renameTag } from "./actions";

export const metadata: Metadata = { title: "Settings · The Bass Agency CRM" };

const TAG_NOTICES: Record<string, { text: string; ok: boolean }> = {
  renamed: { text: "Tag renamed on every contact.", ok: true },
  removed: { text: "Tag removed from every contact.", ok: true },
  invalid: { text: `Enter a new name (up to ${MAX_TAG_LENGTH} characters, no commas).`, ok: false },
  error: { text: "That didn't work. Please try again.", ok: false },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId, email } = await requireFullSession();
  const [profile, rules, crossSell, intakeLink, tags] = await Promise.all([
    getProfile(supabase, userId), getRules(supabase), getCrossSellRules(supabase), getIntakeLink(supabase), knownTags(supabase),
  ]);
  const tagNotice = query.tags ? TAG_NOTICES[query.tags] : undefined;
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
      <section aria-labelledby="data-heading" className="flex flex-col gap-2">
        <h2 id="data-heading" className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <Link href="/import" className="inline-flex min-h-11 items-center underline">Import clients from a CSV report</Link>
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">Download a copy (CSV files that open in Excel or Numbers). Keep them somewhere safe: they contain client details.</p>
        <ul aria-label="Downloads" className="flex flex-wrap gap-2">
          {(Object.keys(EXPORT_DATASETS) as ExportDataset[]).map((d) => (
            <li key={d}>
              <a href={`/export/${d}`} download className="flex min-h-11 items-center rounded-md border border-slate-900 px-3 text-sm font-medium dark:border-slate-100">{EXPORT_DATASETS[d].label}</a>
            </li>
          ))}
        </ul>
      </section>
      <section id="tags" aria-labelledby="tags-heading" className="flex flex-col gap-2">
        <h2 id="tags-heading" className="text-lg font-semibold">Tags</h2>
        {tagNotice ? (
          <p role={tagNotice.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${tagNotice.ok ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>{tagNotice.text}</p>
        ) : null}
        {tags.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No tags yet. Add tags such as VIP or Church when you edit a contact.</p>
        ) : (
          <ul aria-label="Tags in use" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {tags.map((t, i) => (
              <li key={t.tag} className="p-3">
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                    {t.tag} <span className="text-sm font-normal text-slate-600 dark:text-slate-400">({t.contact_count} contact{t.contact_count === 1 ? "" : "s"})</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-3">
                    <Link href={`/contacts?tag=${encodeURIComponent(t.tag)}`} className="flex min-h-11 w-fit items-center text-sm underline">Show these contacts</Link>
                    <form action={renameTag} className="flex flex-col gap-1">
                      <input type="hidden" name="from" value={t.tag} />
                      <label htmlFor={`tag-rename-${i}`} className="text-sm font-medium">New name</label>
                      <div className="flex gap-2">
                        <input id={`tag-rename-${i}`} name="to" defaultValue={t.tag} maxLength={MAX_TAG_LENGTH} required
                          className="min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-900" />
                        <button type="submit" className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Rename</button>
                      </div>
                      <p className="text-xs text-slate-500">Renaming to a tag you already use combines the two.</p>
                    </form>
                    <form action={renameTag}>
                      <input type="hidden" name="from" value={t.tag} />
                      <input type="hidden" name="remove" value="1" />
                      <button type="submit" className="min-h-11 rounded-md border border-red-700 px-4 font-medium text-red-800 dark:border-red-400 dark:text-red-300">
                        Remove from {t.contact_count} contact{t.contact_count === 1 ? "" : "s"}
                      </button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
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
