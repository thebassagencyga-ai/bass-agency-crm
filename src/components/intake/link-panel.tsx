import { createOrReplaceIntakeLink, setIntakeLinkEnabled } from "@/app/(app)/intake/actions";
import { qrSvg } from "@/lib/intake/qr";
import type { IntakeLink } from "@/lib/intake/types";
import { CopyButton } from "./copy-button";

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  new: { text: "Your new link is ready. Any earlier link has stopped working.", ok: true },
  on: { text: "The form link is on.", ok: true },
  off: { text: "The form link is off. Anyone opening it is told it is no longer active.", ok: true },
  error: { text: "That didn't work. Please try again.", ok: false },
};

const BUTTON = "min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100";

/** Settings → Intake form: the public link, its QR code, and on/off/replace. */
export function IntakeLinkPanel({ link, baseUrl, notice }: { link: IntakeLink | null; baseUrl: string; notice?: string }) {
  const note = notice ? NOTICES[notice] : undefined;
  const url = link ? `${baseUrl}/quote/${link.token}` : null;
  return (
    <section id="intake" aria-labelledby="intake-heading" className="flex flex-col gap-3">
      <h2 id="intake-heading" className="text-lg font-semibold">Intake form</h2>
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${note.ok ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>{note.text}</p>
      ) : null}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        A public page where prospects request a quote. Requests wait in your Intake inbox until you accept or discard them.
      </p>
      {link && url ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${link.enabled ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
              {link.enabled ? "On" : "Off"}
            </span>
            <a href={url} target="_blank" rel="noopener" className="break-all text-sm underline">{url}</a>
          </p>
          {link.enabled ? (
            <>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={url} />
              </div>
              <figure className="flex flex-col items-start gap-1">
                {/* Server-rendered SVG of the link; contains no script. */}
                <div className="w-48 rounded-md bg-white p-1" role="img" aria-label="QR code for the intake form link" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
                <figcaption className="text-xs text-slate-500">Screenshot or print this QR code for business cards and the office.</figcaption>
              </figure>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <form action={setIntakeLinkEnabled}>
              <input type="hidden" name="id" value={link.id} />
              <input type="hidden" name="enabled" value={link.enabled ? "0" : "1"} />
              <button type="submit" className={BUTTON}>{link.enabled ? "Turn off" : "Turn on"}</button>
            </form>
            <form action={createOrReplaceIntakeLink}>
              <button type="submit" className={BUTTON}>New link</button>
            </form>
          </div>
          <p className="text-xs text-slate-500">New link: the current link stops working at once (use it if the form gets spam). Each link accepts up to 10 requests an hour and 50 a day.</p>
        </>
      ) : (
        <form action={createOrReplaceIntakeLink}>
          <button type="submit" className={BUTTON}>Create my form link</button>
        </form>
      )}
    </section>
  );
}
