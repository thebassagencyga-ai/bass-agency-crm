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
import { addTag, renameTag, setTheme } from "./actions";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, THEME_LABELS, THEMES } from "@/lib/theme";
import { CalendarLinkPanel } from "@/components/calendar/link-panel";
import { AiSettingsPanel } from "@/components/ai/settings-panel";
import { aiEnabled, monthlyBudgetUsd } from "@/lib/ai/config";
import { monthSpendUsd } from "@/lib/ai/run";
import { getCalendarFeed } from "@/lib/calendar/data";
import { formatInstantDate, formatInstantDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Settings · Producr CRM" };

const TAG_NOTICES: Record<string, { text: string; ok: boolean }> = {
  added: { text: "Tag added. Tick it on any contact.", ok: true },
  exists: { text: "That tag is already on the list.", ok: false },
  renamed: { text: "Tag renamed on every contact.", ok: true },
  removed: { text: "Tag removed from every contact.", ok: true },
  invalid: { text: `Enter a new name (up to ${MAX_TAG_LENGTH} characters, no commas).`, ok: false },
  error: { text: "That didn't work. Please try again.", ok: false },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId, email } = await requireFullSession();
  const [profile, rules, crossSell, intakeLink, tags, calendar] = await Promise.all([
    getProfile(supabase, userId), getRules(supabase), getCrossSellRules(supabase), getIntakeLink(supabase), knownTags(supabase),
    getCalendarFeed(supabase),
  ]);
  const aiConnected = aiEnabled();
  const aiSpent = aiConnected ? await monthSpendUsd(supabase) : 0;
  const tagNotice = query.tags ? TAG_NOTICES[query.tags] : undefined;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-medium">Signed in as</dt>
        <dd className="break-all">{email}</dd>
        <dt className="font-medium">Two-step sign-in</dt>
        <dd>On (required)</dd>
        <dt className="font-medium">Time zone</dt>
        <dd>{profile.time_zone.replace("_", " ")}</dd>
      </dl>
      <section id="appearance" aria-labelledby="appearance-heading" className="flex flex-col gap-2">
        <h2 id="appearance-heading" className="text-lg font-semibold">Appearance</h2>
        {query.theme === "saved" ? <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">Appearance saved.</p> : null}
        <form action={setTheme} className="flex flex-col gap-3 rounded-md border border-line bg-card p-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted">Remembered on this device only.</legend>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <label key={t} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong px-2 text-center text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus">
                  <input type="radio" name="theme" value={t} defaultChecked={theme === t} className="sr-only" />
                  {THEME_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="min-h-11 w-fit rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Save appearance</button>
        </form>
      </section>
      <IntakeLinkPanel link={intakeLink} baseUrl={siteUrl()} notice={query.intake} />
      <CalendarLinkPanel
        baseUrl={siteUrl()} notice={query.calendar}
        active={calendar ? {
          since: formatInstantDate(calendar.created_at, profile.time_zone),
          lastUsed: calendar.last_fetched_at ? formatInstantDateTime(calendar.last_fetched_at, profile.time_zone) : null,
        } : null}
      />
      <section aria-labelledby="data-heading" className="flex flex-col gap-2">
        <h2 id="data-heading" className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-muted">
          <Link href="/import" className="inline-flex min-h-11 items-center underline text-link">Import clients from a CSV report</Link>
        </p>
        <p className="text-sm text-muted">Download a copy (CSV files that open in Excel or Numbers). Keep them somewhere safe: they contain client details.</p>
        <ul aria-label="Downloads" className="flex flex-wrap gap-2">
          {(Object.keys(EXPORT_DATASETS) as ExportDataset[]).map((d) => (
            <li key={d}>
              <a href={`/export/${d}`} download className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-3 text-sm font-medium">{EXPORT_DATASETS[d].label}</a>
            </li>
          ))}
        </ul>
      </section>
      <AiSettingsPanel connected={aiConnected} spent={aiSpent} cap={monthlyBudgetUsd()} />
      <section id="tags" aria-labelledby="tags-heading" className="flex flex-col gap-2">
        <h2 id="tags-heading" className="text-lg font-semibold">Tags</h2>
        {tagNotice ? (
          <p role={tagNotice.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${tagNotice.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{tagNotice.text}</p>
        ) : null}
        <p className="text-sm text-muted">The tags you can tick on a contact. Keep the list short so it stays consistent.</p>
        <form action={addTag} className="flex flex-col gap-1">
          <label htmlFor="tag-add" className="text-sm font-medium">Add a tag</label>
          <div className="flex gap-2">
            <input id="tag-add" name="name" maxLength={MAX_TAG_LENGTH} required placeholder="e.g. Golf club"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 py-2 text-base" />
            <button type="submit" className="min-h-11 rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Add</button>
          </div>
        </form>
        {tags.length === 0 ? (
          <p className="text-sm text-muted">No tags on the list.</p>
        ) : (
          <ul aria-label="Tags in use" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
            {tags.map((t, i) => (
              <li key={t.tag} className="p-3">
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                    {t.tag} <span className="text-sm font-normal text-muted">({t.contact_count} contact{t.contact_count === 1 ? "" : "s"})</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-3">
                    {t.contact_count > 0 ? <Link href={`/contacts?tag=${encodeURIComponent(t.tag)}`} className="flex min-h-11 w-fit items-center text-sm underline text-link">Show these contacts</Link> : null}
                    <form action={renameTag} className="flex flex-col gap-1">
                      <input type="hidden" name="from" value={t.tag} />
                      <label htmlFor={`tag-rename-${i}`} className="text-sm font-medium">New name</label>
                      <div className="flex gap-2">
                        <input id={`tag-rename-${i}`} name="to" defaultValue={t.tag} maxLength={MAX_TAG_LENGTH} required
                          className="min-h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 py-2 text-base" />
                        <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Rename</button>
                      </div>
                      <p className="text-xs text-muted">Renaming to a tag you already use combines the two.</p>
                    </form>
                    <form action={renameTag}>
                      <input type="hidden" name="from" value={t.tag} />
                      <input type="hidden" name="remove" value="1" />
                      <button type="submit" className="min-h-11 rounded-md border border-bad px-4 font-medium text-bad">
                        {t.contact_count === 0 ? "Remove from the list" : `Remove from the list and ${t.contact_count} contact${t.contact_count === 1 ? "" : "s"}`}
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
        <p className="text-sm text-muted">Used to fill in the messages on Google review and referral request tasks.</p>
        <ProfileForm displayName={profile.display_name} reviewUrl={profile.google_review_url} />
      </section>
      <section aria-labelledby="rules-heading" className="flex flex-col gap-2">
        <h2 id="rules-heading" className="text-lg font-semibold">Automatic follow-up tasks</h2>
        <p className="text-sm text-muted">
          These create and close tasks for you as opportunities move. Changing a rule affects new tasks only;
          dates you change on a task yourself are never overwritten.
        </p>
        <ul aria-label="Automation rules" className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li key={rule.id}>
              <details className="rounded-md border border-line p-3 bg-card">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-1 py-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {rule.name}
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${rule.enabled ? "bg-good-soft text-good" : "bg-subtle text-fg"}`}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{describeRule(rule)}</span>
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
        <p className="text-sm text-muted">
          Suggest reviewing another line when a client has a policy in one line but nothing in the other. Only recorded
          policies count; a line with an open opportunity, or one lost in the last 12 months, is not suggested.
        </p>
        <ul aria-label="Cross-sell rules" className="flex flex-col gap-2">
          {crossSell.map((rule) => (
            <li key={rule.id}>
              <details className="rounded-md border border-line p-3 bg-card">
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center gap-1 py-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {rule.name}
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${rule.enabled ? "bg-good-soft text-good" : "bg-subtle text-fg"}`}>
                      {rule.enabled ? "On" : "Off"}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{describeCrossSellRule(rule)}</span>
                </summary>
                <div className="mt-3">
                  <CrossSellRuleForm rule={rule} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="rounded-md border border-dashed border-line-strong p-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Add a cross-sell rule</summary>
          <div className="mt-3">
            <CrossSellRuleForm />
          </div>
        </details>
      </section>
      <Link href="/reset-password" className="min-h-11 py-2 underline text-link">Change password</Link>
    </section>
  );
}
