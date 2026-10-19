import type { Metadata } from "next";
import Link from "next/link";
import { ArchivedBadge, MergedBadge, StatusBadge, TagList } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName, contactPersonName } from "@/lib/contacts/format";
import { knownTags, leadSourceOptions, listContacts } from "@/lib/contacts/data";
import { parseContactListParams, type ContactListParams } from "@/lib/contacts/params";
import { RELATIONSHIP_LABELS, RELATIONSHIP_STATUSES } from "@/lib/contacts/types";

export const metadata: Metadata = { title: "Contacts · ZeroLapse CRM" };

const CONTROL =
  "min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

function pageHref(p: ContactListParams, page: number): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.type) qs.set("type", p.type);
  if (p.status) qs.set("status", p.status);
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
  const { supabase } = await requireFullSession();
  const [{ rows, hasMore }, sources, tags] = await Promise.all([listContacts(supabase, params), leadSourceOptions(supabase), knownTags(supabase)]);
  const filtered = Boolean(params.q || params.type || params.status || params.leadSource || params.tag || params.archived !== "active");

  return (
    <section className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/import" className="flex min-h-11 items-center rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Import</Link>
          <Link href="/contacts/new" className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900">
            Add contact
          </Link>
        </div>
      </div>

      <form method="get" action="/contacts" role="search" className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <label htmlFor="q" className="text-sm font-medium">Search</label>
        <div className="flex gap-2">
          <input id="q" name="q" type="search" defaultValue={params.q} placeholder="Name, business, phone or email" className={`${CONTROL} flex-1`} maxLength={100} />
          <button type="submit" className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Search</button>
        </div>
        <details open={filtered && !params.q}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Filters and sorting</summary>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">Type
              <select name="type" defaultValue={params.type ?? ""} className={CONTROL}>
                <option value="">All</option><option value="individual">Individuals</option><option value="business">Businesses</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Status
              <select name="status" defaultValue={params.status ?? ""} className={CONTROL}>
                <option value="">All</option>
                {RELATIONSHIP_STATUSES.map((s) => <option key={s} value={s}>{RELATIONSHIP_LABELS[s]}</option>)}
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
              <button type="submit" className="min-h-11 flex-1 rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Apply</button>
              {filtered ? <Link href="/contacts" className="flex min-h-11 items-center px-2 text-sm underline">Clear</Link> : null}
            </div>
          </div>
        </details>
      </form>

      {params.tag ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
          Tagged <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-900 dark:bg-sky-900 dark:text-sky-100">{params.tag}</span>
          <Link href={pageHref({ ...params, tag: null }, 1)} className="inline-flex min-h-11 items-center underline">Show all tags</Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center dark:border-slate-600">
          {filtered || params.page > 1 ? (
            <p>No contacts match. <Link href="/contacts" className="underline">Clear search and filters</Link></p>
          ) : (
            <p>No contacts yet. <Link href="/contacts/new" className="underline">Add your first contact</Link>, or <Link href="/import" className="underline">import your client list</Link>.</p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700" aria-label="Contacts">
          {rows.map((c) => {
            const person = contactPersonName(c);
            return (
              <li key={c.id}>
                <Link href={`/contacts/${c.id}`} className="flex min-h-11 flex-col gap-1 px-3 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 dark:hover:bg-slate-900">
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">{contactDisplayName(c)}</span>
                    {person ? <span className="text-sm text-slate-600 dark:text-slate-400">{person}</span> : null}
                    {c.tags.length > 0 ? <TagList tags={c.tags} /> : null}
                  </span>
                  <span className="text-sm text-slate-600 sm:w-40 dark:text-slate-400">{c.phone ?? ""}</span>
                  <span className="truncate text-sm text-slate-600 sm:w-56 dark:text-slate-400">{c.email ?? ""}</span>
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
          {params.page > 1 ? <Link href={pageHref(params, params.page - 1)} className="min-h-11 py-2 underline">← Previous</Link> : <span />}
          <span className="text-sm text-slate-500">Page {params.page}</span>
          {hasMore ? <Link href={pageHref(params, params.page + 1)} className="min-h-11 py-2 underline">Next →</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
