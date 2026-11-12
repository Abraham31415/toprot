"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";

// Form parts for the account pages. One input height, border and focus style; labels are always visible and tied to the input; hints and
// errors are linked with aria-describedby so a screen reader reads them with the field.

const INPUT =
  "h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-muted outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:bg-hover sm:text-sm";

type Common = { label: ReactNode; hint?: ReactNode; labelAside?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function TextField({ label, hint, labelAside, id, ...rest }: Common) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={fid} className="text-sm font-medium text-ink">{label}</label>
        {labelAside}
      </div>
      <input id={fid} aria-describedby={hint ? `${fid}-hint` : undefined} className={INPUT} {...rest} />
      {hint && <p id={`${fid}-hint`} className="type-caption">{hint}</p>}
    </div>
  );
}

/** A password field with a show/hide button. The button is a real toggle with an accessible name. */
export function PasswordField({ label, hint, labelAside, id, ...rest }: Common) {
  const auto = useId();
  const fid = id ?? auto;
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={fid} className="text-sm font-medium text-ink">{label}</label>
        {labelAside}
      </div>
      <div className="relative">
        <input id={fid} type={shown ? "text" : "password"} aria-describedby={hint ? `${fid}-hint` : undefined} className={`${INPUT} pr-11`} {...rest} />
        <button
          type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted hover:bg-hover hover:text-ink"
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={`${fid}-hint`} className="type-caption">{hint}</p>}
    </div>
  );
}

/** An error that is announced when it appears, with an icon so it does not rely on colour. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger-ink">
      <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The submit button shared by the account forms. */
export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: ReactNode; pendingLabel: string }) {
  return (
    <button
      type="submit" disabled={pending} aria-busy={pending || undefined}
      className="h-11 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label="or">
      <div className="h-px flex-1 bg-line" />
      <span className="type-caption" aria-hidden="true">or</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
