import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideRoute } from "@/lib/auth/routing";
import { readAuthState } from "@/lib/auth/session";
import { supabaseEnv } from "@/lib/env";
import { buildContentSecurityPolicy, SECURITY_HEADERS } from "@/lib/security/headers";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";

// Runs on every page request (Edge runtime; see ADR-015 for why this is middleware.ts and
// not proxy.ts). It (1) refreshes the Supabase session cookie, (2) decides whether the
// caller may open the page, and (3) sets the CSP nonce and security headers.

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let env: ReturnType<typeof supabaseEnv>;
  try {
    env = supabaseEnv();
  } catch {
    return secure(new NextResponse("Service unavailable: configuration missing.", { status: 503 }), csp);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const cacheHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.cookies.toString());
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        Object.assign(cacheHeaders, headers);
      },
    },
  });

  const { state } = await readAuthState(supabase);
  const decision = decideRoute(request.nextUrl.pathname, state, {
    isServerAction: request.method === "POST" && request.headers.has("next-action"),
    search: request.nextUrl.search,
  });

  let result: NextResponse = response;
  if (decision.action === "redirect") {
    result = NextResponse.redirect(new URL(decision.to, request.url));
  } else if (decision.action === "unauthorized") {
    result = NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (result !== response) {
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
  }
  for (const [name, value] of Object.entries(cacheHeaders)) result.headers.set(name, value);
  return secure(result, csp);
}

function secure(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  // Pages are per-user: never let a shared cache store them.
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
