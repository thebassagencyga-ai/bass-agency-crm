import type { Metadata } from "next";
import Link from "next/link";
import { ArchivedBadge, MergedBadge, StatusBadge, TagList } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName, contactPersonName } from "@/lib/contacts/format";
import { knownTags, leadSourceOptions, listContacts } from "@/lib/contacts/data";
import { loadBookSummaries, loadLeadSummaries, tabCounts } from "@/lib/contacts/list-extras";
import { parseContactListParams, type ContactListParams } from "@/lib/contacts/params";
import type { BookSummary, LeadSummary } from "@/lib/contacts/summaries";
import { CONTACT_TAB_LABELS, CONTACT_TABS } from "@/lib/contacts/tabs";
import type { Contact } from "@/lib/contacts/types";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { getStages } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Contacts · Producr CRM" };

const CONTROL =
  "min-h-11 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

const searching = (p: ContactListParams) => Boolean(p.q || p.type || p.leadSource || p.tag || p.archived !== "active");

function pageHref(p: ContactListParams, page: number): string {
  const qs = new URLSearchParams();
  // Leads is the default only when nothing is searched or filtered (src/lib/contacts/tabs.ts).
  if (p.tab !== "leads" || searching(p)) qs.set("tab", p.tab);
  if (p.q) qs.set("q", p.q);
  if (p.type) qs.set("type", p.type);
  if (p.leadSource) qs.set("source", p.leadSource);
  if (p.tag) qs.set("tag", p.tag);
  if (p.archived !== "active") qs.set("archived", p.archived);
  if (p.sort !== "name") qs.set("sort", p.sort);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/contacts?${s}` : "/contacts";
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseContactListParams(await searchParams);
  const { supabase, userId } = await requireFullSession();
  const [{ rows, hasMore }, sources, tags, counts, profile] = await Promise.all([
    listContacts(supabase, params), leadSourceOptions(supabase), knownTags(supabase), tabCounts(supabase), getProfile(supabase, userId),
  ]);
  const filtered = searching(params);
  const today = todayInZone(profile.time_zone);
  const ids = rows.map((r) => r.id);
  const [leads, book] = await Promise.all([
    params.tab === "leads" ? loadLeadSummaries(supabase, ids, new Map((await getStages(supabase)).map((s) => [s.id, s.name])), today) : null,
    params.tab === "clients" ? loadBookSummaries(supabase, ids, today) : null,
  ]);

  return (
    <section className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/import" className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Import</Link>
          <Link href="/contacts/new" className="flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">
            Add contact
          </Link>
        </div>
      </div>

      {/* Leads | Clients | Former | All (Phase 24). Counts are active contacts, before any search. */}
      <nav aria-label="Contact groups" className="grid grid-cols-4 gap-1 rounded-md bg-subtle p-1">
        {CONTACT_TABS.map((t) => (
          <Link
            key={t}
            href={pageHref({ ...params, tab: t, status: null }, 1)}
            aria-current={params.tab === t ? "page" : undefined}
            className="flex min-h-11 flex-col items-center justify-center rounded px-1 text-sm font-medium text-muted hover:text-fg aria-[current=page]:bg-card aria-[current=page]:text-fg aria-[current=page]:shadow-sm sm:flex-row sm:gap-1"
          >
            {CONTACT_TAB_LABELS[t]}
            <span className="text-xs font-normal">{counts[t]}</span>
          </Link>
        ))}
      </nav>

      <form method="get" action="/contacts" role="search" className="flex flex-col gap-2 rounded-md border border-line p-3 bg-card">
        <input type="hidden" name="tab" value={params.tab} />
        <label htmlFor="q" className="text-sm font-medium">Search</label>
        <div className="flex gap-2">
          <input id="q" name="q" type="search" defaultValue={params.q} placeholder="Name, business, phone or email" className={`${CONTROL} flex-1`} maxLength={100} />
          <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Search</button>
        </div>
        <details open={filtered && !params.q}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Filters and sorting</summary>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">Type
              <select name="type" defaultValue={params.type ?? ""} className={CONTROL}>
                <option value="">All</option><option value="individual">Individuals</option><option value="business">Businesses</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Lead source
              <select name="source" defaultValue={params.leadSource ?? ""} className={CONTROL}>
                <option value="">All</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {tags.length > 0 || params.tag ? (
              <label className="flex flex-col gap-1 text-sm">Tag
                <select name="tag" defaultValue={tags.find((t) => t.tag.toLowerCase() === params.tag?.toLowerCase())?.tag ?? params.tag ?? ""} className={CONTROL}>
                  <option value="">All</option>
                  {params.tag && !tags.some((t) => t.tag.toLowerCase() === params.tag?.toLowerCase()) ? <option value={params.tag}>{params.tag}</option> : null}
                  {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.contact_count})</option>)}
                </select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">Show
              <select name="archived" defaultValue={params.archived} className={CONTROL}>
                <option value="active">Active contacts</option><option value="archived">Archived only</option><option value="all">All</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Sort by
              <select name="sort" defaultValue={params.sort} className={CONTROL}>
                <option value="name">Name</option><option value="recent">Recently added</option><option value="updated">Recently updated</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="min-h-11 flex-1 rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Apply</button>
              {filtered ? <Link href={`/contacts?tab=${params.tab}`} className="flex min-h-11 items-center px-2 text-sm underline text-link">Clear</Link> : null}
            </div>
          </div>
        </details>
      </form>

      {params.tag ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
          Tagged <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-fg">{params.tag}</span>
          <Link href={pageHref({ ...params, tag: null }, 1)} className="inline-flex min-h-11 items-center underline text-link">Show all tags</Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-strong p-6 text-center">
          {filtered || params.page > 1 ? (
            <p>
              No {params.tab === "all" ? "contacts" : CONTACT_TAB_LABELS[params.tab].toLowerCase()} match.{" "}
              {params.tab !== "all" ? <><Link href={pageHref({ ...params, tab: "all", status: null }, 1)} className="underline text-link">Search all contacts</Link> or </> : null}
              <Link href={`/contacts?tab=${params.tab}`} className="underline text-link">clear search and filters</Link>.
            </p>
          ) : params.tab === "leads" && counts.all > 0 ? (
            <p>No open leads. <Link href="/contacts/new" className="underline text-link">Add a lead</Link> or share your quote form from Settings.</p>
          ) : params.tab === "clients" && counts.all > 0 ? (
            <p>No clients yet. A lead becomes a client when you mark a policy Bound.</p>
          ) : params.tab === "former" && counts.all > 0 ? (
            <p>No former clients.</p>
          ) : (
            <p>No contacts yet. <Link href="/contacts/new" className="underline text-link">Add your first contact</Link>, or <Link href="/import" className="underline text-link">import your client list</Link>.</p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-card" aria-label="Contacts">
          {rows.map((c) => {
            const person = contactPersonName(c);
            return (
              <li key={c.id}>
                <Link href={`/contacts/${c.id}`} className="flex min-h-11 flex-col gap-1 px-3 py-3 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4">
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">{contactDisplayName(c)}</span>
                    {person ? <span className="text-sm text-muted">{person}</span> : null}
                    {c.tags.length > 0 ? <TagList tags={c.tags} /> : null}
                    {leads ? <LeadDetails summary={leads.get(c.id)} /> : null}
                    {book ? <BookDetails summary={book.get(c.id)} /> : null}
                  </span>
                  <ContactInfo contact={c} compact={Boolean(leads || book)} />
                  <span className="flex gap-1">
                    <StatusBadge status={c.relationship_status} />
                    {c.merged_into_contact_id ? <MergedBadge /> : c.archived_at ? <ArchivedBadge /> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {params.page > 1 || hasMore ? (
        <nav aria-label="Pages" className="flex items-center justify-between">
          {params.page > 1 ? <Link href={pageHref(params, params.page - 1)} className="min-h-11 py-2 underline text-link">← Previous</Link> : <span />}
          <span className="text-sm text-muted">Page {params.page}</span>
          {hasMore ? <Link href={pageHref(params, params.page + 1)} className="min-h-11 py-2 underline text-link">Next →</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function ContactInfo({ contact, compact }: { contact: Contact; compact: boolean }) {
  if (compact) return <span className="text-sm text-muted sm:w-40">{contact.phone ?? contact.email ?? ""}</span>;
  return (
    <>
      <span className="text-sm text-muted sm:w-40">{contact.phone ?? ""}</span>
      <span className="truncate text-sm text-muted sm:w-56">{contact.email ?? ""}</span>
    </>
  );
}

/** Leads tab: each open deal's line and stage (quote date when quoted), and the next task. */
function LeadDetails({ summary }: { summary: LeadSummary | undefined }) {
  if (!summary || (summary.deals.length === 0 && !summary.nextTask)) {
    return <span className="text-sm text-muted">No open deal or task</span>;
  }
  return (
    <span className="flex flex-col text-sm">
      {summary.deals.slice(0, 3).map((d, i) => (
        <span key={i}>
          {PRODUCT_LINE_NAMES[d.line]} · {d.nurture ? "Nurture" : d.stage}
          {d.quoteSentOn ? <span className="text-muted"> · quoted {formatDateOnly(d.quoteSentOn)}</span> : null}
        </span>
      ))}
      {summary.deals.length > 3 ? <span className="text-muted">+{summary.deals.length - 3} more</span> : null}
      {summary.nextTask ? (
        <span className={summary.nextTask.overdue ? "text-bad" : "text-muted"}>
          Next: {summary.nextTask.title} · {summary.nextTask.overdue ? "overdue " : ""}{formatDateOnly(summary.nextTask.due)}
        </span>
      ) : <span className="text-caution">No next task</span>}
    </span>
  );
}

/** Clients tab (the book): lines held, premium on active policies, next renewal, cross-sell gaps. */
function BookDetails({ summary }: { summary: BookSummary | undefined }) {
  if (!summary || summary.lines.length === 0) return <span className="text-sm text-muted">No active policy recorded</span>;
  return (
    <span className="flex flex-col text-sm">
      <span>
        {summary.lines.map((l) => PRODUCT_LINE_NAMES[l]).join(" · ")}
        {summary.premium !== null ? (
          <span className="text-muted"> · {formatMoney(summary.premium, { whole: true })}{summary.premiumComplete ? "" : "+"}/yr</span>
        ) : null}
      </span>
      {summary.nextRenewal ? <span className="text-muted">Next renewal {formatDateOnly(summary.nextRenewal)}</span> : null}
      {summary.gaps.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {summary.gaps.map((g) => (
            <span key={g} className="rounded bg-brand-soft px-2 py-0.5 text-xs font-medium text-fg">No {PRODUCT_LINE_NAMES[g].toLowerCase()}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
