"use client";

import { useFormStatus } from "react-dom";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; message?: string };

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="min-h-11 w-full rounded-md bg-slate-900 px-4 py-2 text-base font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function Field({
  label, name, type = "text", autoComplete, error, inputMode, required = true, defaultValue,
}: {
  label: string; name: string; type?: string; autoComplete?: string; error?: string;
  inputMode?: "numeric" | "email" | "text"; required?: boolean; defaultValue?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">{label}</label>
      <input
        id={name} name={name} type={type} autoComplete={autoComplete} inputMode={inputMode}
        required={required} defaultValue={defaultValue}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 aria-[invalid=true]:border-red-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      {error ? <p id={errorId} className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function FormAlert({ state }: { state: FormState }) {
  if (state.error) {
    return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>;
  }
  if (state.message) {
    return <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{state.message}</p>;
  }
  return null;
}
