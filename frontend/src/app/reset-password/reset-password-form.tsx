"use client";

import { useActionState } from "react";
import { updatePassword, type ResetPasswordState } from "./actions";
import { FormError, PasswordField, SubmitButton } from "@/components/auth/fields";

const initialState: ResetPasswordState = undefined;

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <PasswordField label="New password" name="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." />
      <FormError>{state?.error}</FormError>
      <SubmitButton pending={pending} pendingLabel="Updating...">Update password</SubmitButton>
    </form>
  );
}
