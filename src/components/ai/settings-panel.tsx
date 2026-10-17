/** Settings → AI helpers (Phase 19, ADR-035): whether they are connected and this month's spend. */
export function AiSettingsPanel({ connected, spent, cap }: { connected: boolean; spent: number | null; cap: number }) {
  const money = (n: number) => `$${n.toFixed(2)}`;
  return (
    <section id="ai" aria-labelledby="ai-heading" className="flex flex-col gap-2">
      <h2 id="ai-heading" className="text-lg font-semibold">AI helpers</h2>
      {connected ? (
        <p className="text-sm">
          On. This month: {spent === null ? "usage could not be read" : `${money(spent)} of ${money(cap)}`}. When the month&apos;s budget is used up the
          helpers stop until the 1st.
        </p>
      ) : (
        <p className="text-sm">
          Not connected. The CRM works the same without them. To turn them on, the owner adds an Anthropic API key as the
          <code className="mx-1">ANTHROPIC_API_KEY</code> secret in Cloudflare (runbook §4d).
        </p>
      )}
      <ul className="list-disc pl-5 text-sm text-slate-600 dark:text-slate-400">
        <li>Draft a text or email (contact page → Text or email → Draft with AI).</li>
        <li>Fill in an activity from rough notes (contact page → Log activity).</li>
        <li>Daily briefing (dashboard).</li>
        <li>Suggest column and policy-type matches when importing.</li>
      </ul>
      <p className="text-xs text-slate-500">
        Every AI result is a suggestion: nothing is saved or sent until you do it. The AI receives only what each helper lists
        (first names, never phone numbers, emails, addresses, or notes beyond what you type), and text that looks like an SSN,
        card, bank, license or health detail is refused. Capped at {money(cap)} a month.
      </p>
    </section>
  );
}
