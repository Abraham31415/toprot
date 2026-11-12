"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { createStudy, type CreateStudyState } from "@/app/studies/actions";
import { FormError } from "@/components/auth/fields";

const initialState: CreateStudyState = undefined;

/**
 * Starting a project. A single "New research project" button opens a small form under the header (one primary action, no competing input).
 * With no projects yet the form is already open and the button reads "Create first project".
 */
export function NewProjectPanel({ startOpen = false, first = false }: { startOpen?: boolean; first?: boolean }) {
  const [state, formAction, pending] = useActionState(createStudy, initialState);
  const [open, setOpen] = useState(startOpen);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const wasOpened = useRef(false);
  // Move focus with the interface: into the field when the form opens, back to the button when it closes.
  useEffect(() => {
    if (open && !startOpen) input.current?.focus();
    if (!open && wasOpened.current) opener.current?.focus();
    wasOpened.current = open;
  }, [open, startOpen]);

  return (
    <div>
      {!open && (
        <button
          ref={opener} type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="new-project-form"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {first ? "Create first project" : "New research project"}
        </button>
      )}
      {open && (
        <form
          id="new-project-form" action={formAction} aria-label="New research project"
          onKeyDown={(e) => { if (e.key === "Escape" && !startOpen) setOpen(false); }}
          className="w-full max-w-xl rounded-card border border-line bg-surface p-4 shadow-card"
        >
          <label htmlFor="new-project-title" className="text-sm font-medium text-ink">Project title</label>
          <input
            id="new-project-title" ref={input} name="title" required autoComplete="off"
            aria-describedby="new-project-hint"
            placeholder="e.g. Incidence of ROP among preterm infants at Mulago"
            className="mt-1.5 h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-muted outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 sm:text-sm"
          />
          <p id="new-project-hint" className="type-caption mt-1.5">A protocol with eight sections is created for you to fill in.</p>
          {state?.error && <div className="mt-3"><FormError>{state.error}</FormError></div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="submit" disabled={pending} aria-busy={pending || undefined}
              className="h-10 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {pending ? "Creating..." : "Create project"}
            </button>
            {!startOpen && (
              <button
                type="button" onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-ink-soft hover:bg-hover"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
