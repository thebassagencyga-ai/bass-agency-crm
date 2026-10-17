import { buildCalendar, type FeedTask } from "@/lib/calendar/ics";
import { siteUrl } from "@/lib/env";
import { createAnonClient } from "@/lib/supabase/anon";

// Calendar subscription feed (Phase 18, ADR-034): /calendar/<token>.ics, fetched by calendar
// apps without signing in. The only thing it can do is call public.calendar_feed with the token,
// which returns the open tasks of that link's owner — or nothing for an unknown or turned-off link.

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = file.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return NOT_FOUND();

  const { data, error } = await createAnonClient().rpc("calendar_feed", { p_token: token });
  if (error) {
    if (error.code === "P0002") return NOT_FOUND();
    return new Response("Calendar temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "600" } });
  }
  const appUrl = siteUrl();
  const body = buildCalendar((data ?? []) as FeedTask[], { appUrl, now: new Date(), host: new URL(appUrl).host });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="crm-tasks.ics"',
      // Client names inside: never stored by shared caches, never indexed.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
