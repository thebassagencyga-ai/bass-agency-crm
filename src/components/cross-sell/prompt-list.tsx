import Link from "next/link";
import { dismissCrossSell } from "@/app/(app)/renewals/actions";
import { contactDisplayName } from "@/lib/contacts/format";
import type { CrossSellPrompt } from "@/lib/cross-sell/types";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";

/**
 * Cross-sell review prompts with the reason, a link to start the suggested opportunity, and
 * "Not now" (hidden 12 months). `back` is the page to return to after dismissing.
 */
export function CrossSellPromptList({
  prompts, back, showContact, notice,
}: { prompts: CrossSellPrompt[]; back: string; showContact: boolean; notice?: "dismissed" | "dismisserror" }) {
  return (
    <section aria-labelledby="cross-sell-heading" className="flex flex-col gap-2">
      <h2 id="cross-sell-heading" className="text-lg font-semibold">Cross-sell reviews</h2>
      {notice === "dismissed" ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">Hidden for 12 months.</p>
      ) : notice === "dismisserror" ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">That didn&apos;t work. Please try again.</p>
      ) : null}
      {prompts.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Nothing to review. Suggestions appear here when a client has a policy in one line but not another (rules are in Settings).
        </p>
      ) : (
        <ul aria-label="Cross-sell reviews" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {prompts.map((p) => (
            <li key={`${p.contact_id}-${p.rule_id}`} className="flex flex-col gap-2 p-3">
              <div className="flex min-w-0 flex-col">
                {showContact ? (
                  <Link href={`/contacts/${p.contact_id}`} className="flex min-h-11 items-center font-medium break-words underline-offset-2 hover:underline">{contactDisplayName(p)}</Link>
                ) : null}
                <span className={showContact ? "text-sm" : "font-medium"}>Review {PRODUCT_LINE_NAMES[p.lacks_line]}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">{p.reason}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/opportunities/new?contact=${p.contact_id}&line=${p.lacks_line}`}
                  className="flex min-h-11 items-center rounded-md border border-slate-900 px-3 text-sm font-medium dark:border-slate-100"
                >
                  Start {PRODUCT_LINE_NAMES[p.lacks_line]} opportunity
                </Link>
                <form action={dismissCrossSell}>
                  <input type="hidden" name="contact_id" value={p.contact_id} />
                  <input type="hidden" name="rule_id" value={p.rule_id} />
                  <input type="hidden" name="back" value={back} />
                  <button
                    type="submit"
                    aria-label={`Not now: ${PRODUCT_LINE_NAMES[p.lacks_line]} for ${contactDisplayName(p)} (hide for 12 months)`}
                    className="min-h-11 rounded-md px-3 text-sm underline"
                  >
                    Not now
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
