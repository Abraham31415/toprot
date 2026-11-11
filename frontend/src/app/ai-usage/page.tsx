import { redirect } from "next/navigation";

// The AI credit balance now lives on the billing page, together with plans, purchased credits and payment history.
export default function AiUsagePage() {
  redirect("/billing");
}
