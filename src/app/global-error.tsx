"use client";

// Last-resort error page, used only if the root layout itself fails. It replaces the whole
// document, so it carries its own <html> and minimal inline styles. No error details are
// shown; Next.js logs them on the server with a reference (digest).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#fff", color: "#0f172a" }}>
        <main style={{ maxWidth: "28rem", margin: "0 auto", padding: "4rem 1.5rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.5 }}>The CRM couldn&apos;t load. Your data is safe. Try again in a moment.</p>
          {error.digest ? <p style={{ fontSize: ".8rem", color: "#475569" }}>Reference: {error.digest}</p> : null}
          <button
            type="button" onClick={reset}
            style={{ minHeight: 44, padding: "0 1rem", borderRadius: 6, border: 0, background: "#0f172a", color: "#fff", fontWeight: 600 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
