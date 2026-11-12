import { MfaSetup } from "@/components/admin/mfa-setup";
import { Notice, PageTitle, Section } from "@/components/admin/ui";
import { getAdminSession, mfaRequired } from "@/lib/admin/auth";

export const metadata = { title: "Security" };

// The one admin page that does not insist on a verified session, because this is where the code is entered. It still requires a
// signed-in administrator.
export default async function SecurityPage() {
  const s = await getAdminSession();
  return (
    <>
      <PageTitle title="Security" lead="Two-step verification protects the admin console, which can read financial and account data and change credits." />
      {!mfaRequired() && <Notice tone="warning" title="Two-step verification is switched off">ADMIN_MFA_REQUIRED is set to false on the server, so the console can be opened without a code. Remove that setting once two-step verification is available.</Notice>}
      <Section title="Authenticator app">
        {mfaRequired() ? <MfaSetup aal={s.aal} /> : <p className="type-support">Set up is optional while the requirement is off. You can still turn it on from here once the project allows it.</p>}
      </Section>
      <Section title="Other protections">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Administrators are listed only in a table that the website and browser cannot read or write. New administrators are added with SQL by the project owner.</li>
          <li>Every admin page and every change checks the administrator again on the server, and the database checks once more.</li>
          <li>Every change needs a reason and is written to a tamper-evident audit log. Viewing an account&apos;s private page is logged too.</li>
          <li>Changes to credits and accounts are limited per hour, and promotional credits are capped per grant and per day.</li>
        </ul>
      </Section>
    </>
  );
}
