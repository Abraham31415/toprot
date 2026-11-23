"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { markRead } from "./actions";

export function MarkReadButton({ id, label }: { id: string | null; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="secondary" size="sm" loading={pending} onClick={() => start(async () => { await markRead(id); router.refresh(); })}>{label}</Button>;
}
