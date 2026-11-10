"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";

const initialState: LoginState = undefined;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-navy/85">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium text-navy/85">Password</span>
          <Link href="/forgot-password" className="text-xs font-medium text-navy/65 hover:text-navy">
            Forgot password?
          </Link>
        </div>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35"
        />
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-navy py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal disabled:opacity-50"
      >
        {pending ? "Logging in..." : "Log in"}
      </button>

      <p className="text-center text-sm text-navy/65">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-navy">
          Register
        </Link>
      </p>
    </form>
  );
}
