"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100"
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}
