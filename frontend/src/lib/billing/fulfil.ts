import type { RpcClient } from "@/lib/ai/types";
import { FlwError, verifyById, verifyByReference, type FlwConfig, type VerifiedTransaction } from "./flutterwave";

// The only route by which a payment turns into a subscription or credits. The browser redirect and the webhook body are
// treated as hints: the transaction is always re-fetched from Flutterwave with our secret key and its status, reference,
// amount and currency are checked before anything is granted. Granting happens in one Postgres function that re-checks
// the amount and currency against what we expected and is idempotent.

export type FulfilOutcome =
  | { outcome: "fulfilled"; kind?: string }
  | { outcome: "duplicate" }
  | { outcome: "failed" }
  | { outcome: "pending" }
  | { outcome: "unknown" }
  | { outcome: "rejected"; code: string };

type Fetch = typeof fetch;

export async function verifyAndFulfil(
  db: RpcClient,
  cfg: FlwConfig,
  input: { txRef: string; transactionId?: string | null; eventKey?: string | null },
  f: Fetch = fetch,
): Promise<FulfilOutcome> {
  // Throws FlwError(retryable) on network or provider trouble, so a webhook can ask Flutterwave to retry.
  let txn: VerifiedTransaction | null;
  if (input.transactionId) {
    txn = await verifyById(cfg, input.transactionId, f);
    if (txn.txRef !== input.txRef) return { outcome: "rejected", code: "reference_mismatch" };
  } else {
    txn = await verifyByReference(cfg, input.txRef, f);
    if (!txn) return { outcome: "pending" };
  }
  if (txn.status === "pending") return { outcome: "pending" };

  const { data, error } = await db.rpc("billing_fulfill_payment", {
    p_tx_ref: input.txRef, p_provider_txn: txn.id, p_provider_status: txn.status, p_amount: txn.amount,
    p_currency: txn.currency, p_method: txn.paymentType, p_event_key: input.eventKey ?? null,
  });
  if (error) throw new FlwError("Could not record the payment.", true);
  const r = (data ?? {}) as { ok?: boolean; code?: string; duplicate?: boolean; status?: string; kind?: string };
  if (r.ok === true) {
    if (r.duplicate) return { outcome: "duplicate" };
    if (r.status === "failed") return { outcome: "failed" };
    return { outcome: "fulfilled", kind: r.kind };
  }
  if (r.code === "unknown_reference") return { outcome: "unknown" };
  return { outcome: "rejected", code: r.code ?? "rejected" };
}
