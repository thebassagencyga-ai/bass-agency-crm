import { formatDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import { RENEWAL_LOSS_REASON_LABELS, RENEWAL_OUTCOME_LABELS, type RenewalOutcomeRecord } from "@/lib/renewals/types";

/** Retention history for one policy (newest first). Records are never edited or deleted. */
export function RenewalHistory({ outcomes }: { outcomes: RenewalOutcomeRecord[] }) {
  return (
    <section aria-labelledby="renewal-history-heading" className="flex flex-col gap-2">
      <h2 id="renewal-history-heading" className="text-lg font-semibold">Renewal history</h2>
      {outcomes.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No renewal outcomes recorded yet.</p>
      ) : (
        <ul aria-label="Renewal history" className="flex flex-col gap-3">
          {outcomes.map((o) => (
            <li key={o.id} className="flex flex-col">
              <span className="font-medium">{formatDateOnly(o.renewal_date)} · {RENEWAL_OUTCOME_LABELS[o.outcome]}</span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {[
                  o.loss_reason ? RENEWAL_LOSS_REASON_LABELS[o.loss_reason] : null,
                  o.premium !== null ? `${formatMoney(o.premium)}/yr` : null,
                  o.next_renewal_date ? `Next renewal ${formatDateOnly(o.next_renewal_date)}` : null,
                  `Recorded ${formatDateOnly(o.recorded_on)}`,
                ].filter(Boolean).join(" · ")}
              </span>
              {o.notes ? <span className="text-sm break-words whitespace-pre-line">{o.notes}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
