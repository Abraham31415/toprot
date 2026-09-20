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
      <div className="flex rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
        {(["student", "supervisor"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
              role === r
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input type="hidden" name="role" value={role} />

      {role === "student" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Start your study in minutes.
        </p>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Creates a workspace for reviewing studies students invite you to.
        </p>
      )}

      <GoogleSignInButton />
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        <span className="text-xs text-zinc-400 dark:text-zinc-600">or</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
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
        className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Creating account..." : `Create ${role} account`}
      </button>

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 dark:text-zinc-100">
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
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        name={name}
        type={type}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
        {...rest}
      />
    </label>
  );
}
