/** A post-login destination from a query string, accepted only when it is a same-site path we link to ourselves. */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\/invite\/[0-9a-f]{64}$/.test(value)) return value;
  if (value === "/shared") return value;
  return null;
}
