"use client";

import { useActionState, useState } from "react";
import { chooseRole, type OnboardingState } from "./actions";
import { FormError, SubmitButton } from "@/components/auth/fields";
import { RoleSwitch, ROLE_LABEL, type Role } from "@/components/auth/role-switch";

const initialState: OnboardingState = undefined;

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(chooseRole, initialState);
  const [role, setRole] = useState<Role>("student");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <RoleSwitch value={role} onChange={setRole} />
      <input type="hidden" name="role" value={role} />
      <FormError>{state?.error}</FormError>
      <SubmitButton pending={pending} pendingLabel="Saving...">Continue as {ROLE_LABEL[role].toLowerCase()}</SubmitButton>
    </form>
  );
}
