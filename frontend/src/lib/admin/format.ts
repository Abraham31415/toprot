// Formatting and wording shared by the admin pages. Missing data is shown as "Not available", never as zero.

export const NA = "Not available";

export const num = (n: number | string | null | undefined): string => (n === null || n === undefined || n === "" ? NA : Number(n).toLocaleString("en-GB"));
export const dec = (n: number | string | null | undefined, digits = 1): string => (n === null || n === undefined || n === "" ? NA : Number(n).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }));

export function money(amount: number | string | null | undefined, currency = "USD", digits = 2): string {
  if (amount === null || amount === undefined || amount === "") return NA;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount)); }
  catch { return `${Number(amount).toFixed(digits)} ${currency}`; }
}

/** Lists amounts in each currency ("US$12.98, KES 1,000") because currencies are never converted or added together. */
export const moneyList = (rows: { currency: string; amount: number | string }[] | null | undefined): string =>
  !rows || rows.length === 0 ? money(0) : rows.map((r) => money(r.amount, r.currency)).join(" + ");

export function pct(part: number, whole: number, digits = 1): string {
  if (!whole) return NA;
  return `${((100 * part) / whole).toFixed(digits)}%`;
}

export function dateTime(iso: string | null | undefined, tz = "UTC"): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function date(iso: string | null | undefined, tz = "UTC"): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
}

/** Turns what the database or a guard says into a sentence an administrator can act on. */
export function adminErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  const table: [string, string][] = [
    ["not_admin", "You are not an administrator."],
    ["read_only_admin", "Your administrator role is read-only, so you cannot make changes."],
    ["reason_required", "Give a reason of at least 10 characters. It is saved in the audit log."],
    ["rate_limited", "Too many changes in the last hour. Wait before making more."],
    ["cannot_suspend_admin", "Administrators cannot be suspended, and you cannot suspend yourself."],
    ["unknown_user", "That account does not exist."],
    ["credits_out_of_range", "That number of credits is outside the allowed range for one grant."],
    ["expiry_out_of_range", "Choose an expiry between 1 and 365 days."],
    ["daily_limit_reached", "This would exceed your daily limit for promotional credits."],
    ["not_a_grant", "Only promotional grants can be taken back, not purchases."],
    ["already_expired", "That grant has already expired or been removed."],
    ["credits_in_use", "Some of those credits are being used by a running request. Try again shortly."],
    ["setting_not_editable", "That setting cannot be changed here."],
    ["invalid_value", "That value is outside the allowed range."],
    ["unknown_feature", "That AI feature does not exist."],
  ];
  for (const [k, v] of table) if (m.includes(k)) return v;
  return "The change could not be made. Nothing was changed.";
}

/** Does the text look like it came from a request to change something sensitive without a reason? Used by the forms before submitting. */
export const hasReason = (s: unknown): s is string => typeof s === "string" && s.trim().length >= 10;
