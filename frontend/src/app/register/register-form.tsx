"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerUser, type RegisterState } from "./actions";
import { GoogleSignInButton } from "@/components/google-signin-button";

const initialState: RegisterState = undefined;

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerUser, initialState);
  const [role, setRole] = useState<"student" | "supervisor">("student");
  const [fullName, setFullName] = useState("");
  const [institution, setInstitution] = useState("");
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex rounded-lg border border-line p-1">
        {(["student", "supervisor"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
              role === r
                ? "bg-primary text-white"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      {role === "student" ? (
        <p className="text-sm text-ink-muted">
          Start your study in minutes.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Creates a workspace for reviewing studies students invite you to.
        </p>
      )}

      <GoogleSignInButton />
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-navy/10" />
        <span className="text-xs text-ink-muted">or</span>
        <div className="h-px flex-1 bg-navy/10" />
      </div>

      <Field
        label="Full name"
        name="full_name"
        autoComplete="name"
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <Field
        label="Institution"
        name="institution"
        autoComplete="organization"
        placeholder="e.g. Makerere University Dept. of Ophthalmology"
        value={institution}
        onChange={(e) => setInstitution(e.target.value)}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Creating account..." : `Create ${role} account`}
      </button>

      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink">
          Log in
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink-soft">{label}</span>
      <input
        name={name}
        type={type}
        className="rounded-control border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-line-strong"
        {...rest}
      />
    </label>
  );
}
