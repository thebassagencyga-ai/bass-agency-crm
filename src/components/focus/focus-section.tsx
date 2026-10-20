import Link from "next/link";
import { snoozeDeal } from "@/app/(app)/dashboard/actions";
import { setTaskStatus } from "@/app/(app)/tasks/actions";
import { contactDisplayName } from "@/lib/contacts/format";
import {
  FOCUS_SHOWN, QUIET_OPEN_DAYS, QUIET_QUOTE_DAYS, focusCount, nurtureReason, quietReason, requoteReason,
  type FocusList, type FocusTask, type NurtureDeal, type QuietDeal,
} from "@/lib/focus";
import { smsHref, telHref } from "@/lib/messages/links";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";

// ProducrIQ Focus (Phase 27, ADR-045): deals that need the agent today, each with the reason it
// is listed and one-tap actions. Read-only list from focus_list; fixed rules, no AI. A card
// leaves the list when the agent acts (logs activity, moves the stage, sets a date, completes or
// snoozes). Call and Text open the phone's own apps; nothing is sent by the CRM.

const BTN = "flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium";
const PRIMARY = `${BTN} bg-brand text-on-brand hover:bg-brand-hover`;
const SECONDARY = `${BTN} border border-line-strong bg-card hover:bg-subtle`;
const QUIET = `${BTN} bg-subtle hover:bg-line`;

type Contactish = Pick<QuietDeal, "contact_id" | "contact_type" | "first_name" | "last_name" | "business_name" | "phone">;

function ContactButtons({ c, primaryCall = true }: { c: Contactish; primaryCall?: boolean }) {
  const name = contactDisplayName(c);
  const tel = telHref(c.phone);
  const sms = smsHref(c.phone, "");
  return (
    <>
      {tel ? <a href={tel} aria-label={`Call ${name}`} className={primaryCall ? PRIMARY : SECONDARY}>Call</a> : null}
      {sms ? <a href={sms} aria-label={`Text ${name}`} className={SECONDARY}>Text</a> : null}
    </>
  );
}

function TaskButton({ id, status, label, name, style }: { id: string; status: "completed" | "cancelled"; label: string; name: string; style: string }) {
  return (
    <form action={setTaskStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="back" value="/dashboard" />
      <button type="submit" aria-label={`${label}: ${name}`} className={style}>{label}</button>
    </form>
  );
}

function Card({ title, href, detail, reason, children }: { title: string; href: string; detail: string; reason: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3 shadow-sm">
      <div className="flex flex-col">
        <Link href={href} className="flex min-h-11 w-fit items-center font-semibold break-words underline-offset-2 hover:underline">{title}</Link>
        <span className="text-sm text-muted">{detail}</span>
      </div>
      <p className="text-sm">{reason}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function dealDetail(d: Pick<QuietDeal, "product_line" | "stage_name" | "estimated_annual_premium">): string {
  const premium = formatMoney(d.estimated_annual_premium, { whole: true });
  return [PRODUCT_LINE_NAMES[d.product_line], d.stage_name, premium ? `${premium}/yr` : null].filter(Boolean).join(" · ");
}

function QuietCard({ d, quote }: { d: QuietDeal; quote: boolean }) {
  const name = contactDisplayName(d);
  return (
    <Card title={name} href={`/opportunities/${d.opportunity_id}`} detail={dealDetail(d)} reason={quietReason(d, quote)}>
      <ContactButtons c={d} />
      <Link href={`/contacts/${d.contact_id}#log-activity`} className={SECONDARY}>Log activity</Link>
      <form action={snoozeDeal} className="flex flex-wrap gap-2">
        <input type="hidden" name="id" value={d.opportunity_id} />
        <button type="submit" name="days" value="3" aria-label={`Snooze ${name} for 3 days`} className={QUIET}>Snooze 3 days</button>
        <button type="submit" name="days" value="7" aria-label={`Snooze ${name} for 1 week`} className={QUIET}>1 week</button>
      </form>
    </Card>
  );
}

function NurtureCard({ d, today }: { d: NurtureDeal; today: string }) {
  return (
    <Card title={contactDisplayName(d)} href={`/opportunities/${d.opportunity_id}`} detail={dealDetail(d)} reason={nurtureReason(d, today)}>
      <ContactButtons c={d} />
      <Link href={`/opportunities/${d.opportunity_id}#nurture`} className={SECONDARY}>{d.nurture_check_back_on ? "New date" : "Pick a date"}</Link>
    </Card>
  );
}

function RequoteCard({ t }: { t: FocusTask }) {
  const name = contactDisplayName(t);
  const detail = [t.product_line ? PRODUCT_LINE_NAMES[t.product_line] : null, t.outcome === "lost" ? "Lost" : t.outcome === "nurture" ? "Nurture" : null].filter(Boolean).join(" · ");
  return (
    <Card title={name} href={t.opportunity_id ? `/opportunities/${t.opportunity_id}` : `/tasks/${t.task_id}`} detail={detail} reason={requoteReason(t)}>
      {t.opportunity_id ? <Link href={`/opportunities/${t.opportunity_id}`} className={PRIMARY}>Open deal</Link> : null}
      <ContactButtons c={t} primaryCall={false} />
      <TaskButton id={t.task_id} status="completed" label="Done" name={name} style={SECONDARY} />
      <TaskButton id={t.task_id} status="cancelled" label="Not this year" name={name} style={QUIET} />
    </Card>
  );
}

function ThanksCard({ t }: { t: FocusTask }) {
  const name = contactDisplayName(t);
  return (
    <Card title={name} href={`/contacts/${t.contact_id}`} detail={t.title} reason="A quick call or a personal note. Nothing of value.">
      <ContactButtons c={t} />
      <TaskButton id={t.task_id} status="completed" label="Mark thanked" name={name} style={SECONDARY} />
    </Card>
  );
}

function Group<T>({ id, title, rule, items, render }: { id: string; title: string; rule: string; items: T[]; render: (item: T) => React.ReactNode }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, FOCUS_SHOWN);
  const rest = items.slice(FOCUS_SHOWN);
  return (
    <section aria-labelledby={`focus-${id}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`focus-${id}`} className="font-semibold">{title}</h3>
        <span className="rounded-full bg-shell px-2 text-sm font-bold text-shell-fg" aria-label={`${items.length} ${items.length === 1 ? "deal" : "deals"}`}>{items.length}</span>
      </div>
      <p className="text-xs text-muted">{rule}</p>
      <ul aria-label={title} className="flex flex-col gap-2">{shown.map(render)}</ul>
      {rest.length > 0 ? (
        <details className="flex flex-col gap-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">Show {rest.length} more</summary>
          <ul aria-label={`${title}, more`} className="flex flex-col gap-2">{rest.map(render)}</ul>
        </details>
      ) : null}
    </section>
  );
}

export function FocusSection({ focus }: { focus: FocusList }) {
  const total = focusCount(focus);
  return (
    <section id="focus" aria-labelledby="focus-heading" className="flex scroll-mt-4 flex-col gap-4 rounded-lg border border-line bg-subtle p-3 sm:p-4">
      <div className="flex flex-col gap-1">
        <h2 id="focus-heading" className="text-lg font-semibold">Focus</h2>
        <p className="text-sm text-muted">
          {total === 0
            ? "All clear. No deal needs you right now."
            : `${total} ${total === 1 ? "item needs" : "items need"} you. Each one leaves this list when you act on it.`}
        </p>
      </div>
      <Group id="quotes" title="Quotes gone quiet" rule={`Quoted, and nothing logged for ${QUIET_QUOTE_DAYS} or more days.`} items={focus.quiet_quotes}
        render={(d) => <QuietCard key={d.opportunity_id} d={d} quote />} />
      <Group id="open" title="Open deals gone quiet" rule={`Any other open deal with nothing logged for ${QUIET_OPEN_DAYS} or more days.`} items={focus.quiet_open}
        render={(d) => <QuietCard key={d.opportunity_id} d={d} quote={false} />} />
      <Group id="nurture" title="Nurture check-backs" rule="The check-back date you picked when the deal moved to nurture." items={focus.nurture}
        render={(d) => <NurtureCard key={d.opportunity_id} d={d} today={focus.today} />} />
      <Group id="requote" title="Time to re-quote" rule="Before a prospect's current policy renews somewhere else." items={focus.requote}
        render={(t) => <RequoteCard key={t.task_id} t={t} />} />
      <Group id="thanks" title="Say thank you" rule="Someone referred a new contact to you." items={focus.thanks}
        render={(t) => <ThanksCard key={t.task_id} t={t} />} />
      <p className="text-xs text-muted">Built from your own records with fixed rules. No AI.</p>
    </section>
  );
}
