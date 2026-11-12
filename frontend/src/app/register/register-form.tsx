"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerUser, type RegisterState } from "./actions";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { FormError, OrDivider, PasswordField, SubmitButton, TextField } from "@/components/auth/fields";
import { RoleSwitch, ROLE_LABEL, type Role } from "@/components/auth/role-switch";

const initialState: RegisterState = undefined;

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerUser, initialState);
  const [role, setRole] = useState<Role>("student");
  // Controlled so that what a person typed is still there if the server sends back an error.
  const [fullName, setFullName] = useState("");
  const [institution, setInstitution] = useState("");
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <RoleSwitch value={role} onChange={setRole} />
      <input type="hidden" name="role" value={role} />

      <GoogleSignInButton />
      <OrDivider />

      <TextField label="Full name" name="full_name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <PasswordField label="Password" name="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." />
      <TextField
        label="Institution (optional)" name="institution" autoComplete="organization" value={institution} onChange={(e) => setInstitution(e.target.value)}
        placeholder="e.g. Makerere University"
      />

      <FormError>{state?.error}</FormError>

      <SubmitButton pending={pending} pendingLabel="Creating account...">
        Create {ROLE_LABEL[role].toLowerCase()} account
      </SubmitButton>

      <p className="type-caption text-center">
        By creating an account you agree to the <Link href="/terms" className="underline hover:text-primary">Terms</Link> and{" "}
        <Link href="/privacy" className="underline hover:text-primary">Privacy Policy</Link>.
      </p>
    </form>
  );
}
