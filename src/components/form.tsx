"use client";

import { useFormStatus } from "react-dom";

// `values` echoes back non-secret inputs (never passwords or codes): React resets a form after
// its action runs, and the fields are restored from these defaults.
export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  values?: Record<string, string>;
  /** Possible duplicates found before saving; the user can review or save anyway. */
  duplicates?: { id: string; label: string; detail: string }[];
};

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

const INPUT_CLASS =
  "min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 aria-[invalid=true]:border-red-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function Field({
  label, name, type = "text", autoComplete, error, inputMode, required = true, defaultValue, list, hint, maxLength,
}: {
  label: string; name: string; type?: string; autoComplete?: string; error?: string;
  inputMode?: "numeric" | "decimal" | "email" | "text" | "tel"; required?: boolean; defaultValue?: string;
  list?: string; hint?: string; maxLength?: number;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required ? null : <span className="font-normal text-slate-500"> (optional)</span>}
      </label>
      {hint ? <p id={hintId} className="text-xs text-slate-500">{hint}</p> : null}
      <input
        id={name} name={name} type={type} autoComplete={autoComplete} inputMode={inputMode}
        required={required} defaultValue={defaultValue} list={list} maxLength={maxLength}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        // iOS Safari gives date inputs a fixed native width that ignores CSS width unless
        // the native appearance is removed.
        className={type === "date" ? `${INPUT_CLASS} appearance-none [&::-webkit-date-and-time-value]:text-left` : INPUT_CLASS}
      />
      {error ? <p id={errorId} className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function SelectField({
  label, name, options, defaultValue, error, required = false, placeholder,
}: {
  label: string; name: string; options: readonly { value: string; label: string }[];
  defaultValue?: string; error?: string; required?: boolean; placeholder?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required ? null : <span className="font-normal text-slate-500"> (optional)</span>}
      </label>
      <select
        id={name} name={name} defaultValue={defaultValue ?? ""} required={required}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error ? <p id={errorId} className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function TextAreaField({
  label, name, defaultValue, error, maxLength, hint,
}: { label: string; name: string; defaultValue?: string; error?: string; maxLength?: number; hint?: string }) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label} <span className="font-normal text-slate-500">(optional)</span>
      </label>
      {hint ? <p id={hintId} className="text-xs text-slate-500">{hint}</p> : null}
      <textarea
        id={name} name={name} rows={4} defaultValue={defaultValue} maxLength={maxLength}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className={`${INPUT_CLASS} min-h-24`}
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
