"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { FormError, PasswordField, SubmitButton, TextField } from "@/components/auth/fields";

const initialState: LoginState = undefined;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <PasswordField
        label="Password" name="password" autoComplete="current-password" required
        labelAside={<Link href="/forgot-password" className="text-xs font-medium text-ink-soft hover:text-primary hover:underline">Forgot password?</Link>}
      />
      <FormError>{state?.error}</FormError>
      <SubmitButton pending={pending} pendingLabel="Logging in...">Log in</SubmitButton>
    </form>
  );
}
