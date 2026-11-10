"use client";

export function TextField({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-navy/85">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35 disabled:opacity-60"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  disabled,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-navy/85">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35 disabled:opacity-60"
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly T[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-navy/85">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35 disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o} value={o} className="capitalize">
            {o.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SaveBar({
  onSave,
  pending,
  savedAt,
  error,
  disabled,
  dirty = false,
  auto = false,
}: {
  onSave: () => void;
  pending: boolean;
  savedAt: number | null;
  error: string | null;
  disabled?: boolean;
  dirty?: boolean;
  /** True when this section saves itself after you stop typing. */
  auto?: boolean;
}) {
  if (disabled) return null;

  let status: { text: string; className: string };
  if (pending) status = { text: "Saving...", className: "text-navy/65" };
  else if (error) status = { text: `Could not save: ${error}`, className: "text-red-600" };
  else if (dirty) {
    status = {
      text: auto ? "Unsaved changes. Saving shortly..." : "Unsaved changes. Select Save section to keep them.",
      className: "text-amber-700",
    };
  } else if (savedAt) {
    status = {
      text: `All changes saved at ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      className: "text-teal-ink",
    };
  } else {
    status = { text: auto ? "Changes save automatically." : "Not saved yet.", className: "text-navy/65" };
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cobalt-dark disabled:opacity-50"
      >
        {pending ? "Saving..." : error ? "Retry" : auto ? "Save now" : "Save section"}
      </button>
      <span role="status" aria-live="polite" className={`text-sm ${status.className}`}>
        {status.text}
      </span>
    </div>
  );
}
