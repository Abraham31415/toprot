"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buttonCls, inputCls } from "./ui";

// Two-step verification for administrators, using the authenticator-app (TOTP) factors built into Supabase Auth. The secret is shown
// once as a code and a QR image, and the six-digit code proves it was set up. Nothing is stored by ToProt itself.

type Phase = "loading" | "enroll" | "verify" | "done" | "off";

export function MfaSetup({ aal }: { aal: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (e) { setError("Could not read your two-step verification settings."); setPhase("off"); return; }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) { setFactorId(verified.id); setPhase(aal === "aal2" ? "done" : "verify"); return; }
      // Remove an abandoned, unverified attempt before starting a new one.
      for (const f of data.all.filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: ee } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `ToProt admin ${new Date().toISOString().slice(0, 10)}` });
      if (ee || !en) { setError("Two-step verification could not be started. It may be switched off for this project in Supabase (Authentication, Multi-Factor)."); setPhase("off"); return; }
      setFactorId(en.id); setQr(en.totp.qr_code); setSecret(en.totp.secret); setPhase("enroll");
    })();
  }, [aal]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) { setError("Could not start the check. Try again."); setBusy(false); return; }
    const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
    setBusy(false);
    if (v.error) { setError("That code is not right, or it expired. Enter the current six digits."); return; }
    setPhase("done");
    router.push("/admin");
    router.refresh();
  }

  if (phase === "loading") return <p className="type-support" role="status">Checking your two-step verification...</p>;
  if (phase === "off") return <p role="alert" className="text-sm text-danger-ink">{error}</p>;
  if (phase === "done") return <p role="status" className="text-sm text-success-ink">Two-step verification is on and this session is verified.</p>;
  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      {phase === "enroll" && (
        <>
          <p className="text-sm text-ink-soft">Scan this code with an authenticator app (such as Google Authenticator, 1Password or Authy), then enter the six-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code to add ToProt Admin to your authenticator app" width={176} height={176} className="rounded-control border border-line bg-white p-2" />}
          {secret && <p className="type-caption">Cannot scan? Enter this key instead: <code className="break-all text-ink">{secret}</code></p>}
        </>
      )}
      {phase === "verify" && <p className="text-sm text-ink-soft">Enter the six-digit code from your authenticator app to continue.</p>}
      <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Six-digit code</span>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required className={inputCls} /></label>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={buttonCls}>{busy ? "Checking..." : phase === "enroll" ? "Turn on and verify" : "Verify"}</button>
    </form>
  );
}
