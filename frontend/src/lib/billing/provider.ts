import { checkoutReady, loadFlwConfig } from "./flutterwave";
import { dodoCheckoutReady, loadDodoConfig } from "./dodo";

// Which payment provider is in use. Dodo Payments if its key is configured; Flutterwave only if that is configured instead.
// All the billing tables are provider-neutral, so this decides only where a customer is sent to pay and how a payment is
// confirmed.

export type ProviderId = "dodo" | "flutterwave";

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  /** Currencies this provider can charge in. Our prices are in USD. */
  currencies: string[];
  /** The provider charges the next month by itself until the customer cancels. */
  autoRenews: boolean;
  /** One sentence on who processes payments, for the pages that mention it. */
  processorNote: string;
};

const INFO: Record<ProviderId, ProviderInfo> = {
  dodo: {
    id: "dodo", name: "Dodo Payments", currencies: ["USD"], autoRenews: true,
    processorNote: "Payments are processed by Dodo Payments, our merchant of record. It collects your card or wallet details and any sales tax or VAT itself; ToProt never sees your payment details.",
  },
  flutterwave: {
    id: "flutterwave", name: "Flutterwave", currencies: ["USD", "UGX"], autoRenews: false,
    processorNote: "Payments are processed by Flutterwave, which handles your card or mobile money details; ToProt never sees them.",
  },
};

export function activeProvider(env: Record<string, string | undefined> = process.env): ProviderId | null {
  if (env.DODO_PAYMENTS_API_KEY?.trim()) return "dodo";
  if (env.FLW_SECRET_KEY?.trim()) return "flutterwave";
  return null;
}

/** Provider details for copy. With no provider configured, describe the intended one (Dodo). */
export function providerInfo(env: Record<string, string | undefined> = process.env): ProviderInfo {
  return INFO[activeProvider(env) ?? "dodo"];
}

export function providerReady(env: Record<string, string | undefined> = process.env): { ok: true; provider: ProviderId } | { ok: false; message: string } {
  const id = activeProvider(env);
  if (id === "dodo") { const r = dodoCheckoutReady(loadDodoConfig(env)); return r.ok ? { ok: true, provider: "dodo" } : r; }
  if (id === "flutterwave") { const r = checkoutReady(loadFlwConfig(env)); return r.ok ? { ok: true, provider: "flutterwave" } : r; }
  return { ok: false, message: "Payments are not switched on yet." };
}
