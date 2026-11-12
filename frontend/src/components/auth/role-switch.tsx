"use client";

// The account type choice. The stored value of the first option is still "student" (the role that owns and edits studies); only the label
// shown to people is "Researcher", which is what independent researchers, clinicians and academics are as well as students.

export type Role = "student" | "supervisor";

export const ROLE_LABEL: Record<Role, string> = { student: "Researcher", supervisor: "Supervisor" };
export const ROLE_HELP: Record<Role, string> = {
  student: "Plan and run your own studies. This includes students, clinicians and independent researchers.",
  supervisor: "Review studies that researchers invite you to supervise.",
};

export function RoleSwitch({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">I am a</legend>
      <div className="grid grid-cols-2 gap-1 rounded-control border border-line-strong bg-surface p-1">
        {(["student", "supervisor"] as const).map((r) => (
          <label
            key={r}
            className={`flex h-9 cursor-pointer items-center justify-center rounded-[0.375rem] text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus ${value === r ? "bg-primary text-white" : "text-ink-soft hover:bg-hover"}`}
          >
            <input type="radio" name="role-choice" value={r} checked={value === r} onChange={() => onChange(r)} className="sr-only" />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
      <p className="type-caption mt-1.5" aria-live="polite">{ROLE_HELP[value]}</p>
    </fieldset>
  );
}
