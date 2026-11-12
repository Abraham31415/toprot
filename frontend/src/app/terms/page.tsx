import type { Metadata } from "next";
import { PageHeading, PageShell, Prose } from "@/components/marketing/ui";
import { LEGAL_LAST_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using ToProt during early access.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Legal"
        title="Terms of Service"
        lead={`Last updated ${LEGAL_LAST_UPDATED}. ToProt is in early access and these terms may change.`}
      />
      <Prose>
        <h2>Using ToProt</h2>
        <p>
          You are responsible for the accuracy and ethics of your research. ToProt is a planning tool. It does not
          replace your supervisor, statistician, or ethics committee.
        </p>
        <h2>Generated content</h2>
        <p>
          Documents and AI reviewer questions are drafts. Review them before use. They are provided without any
          guarantee that they are correct or suitable for a particular submission.
        </p>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not enter identifiable patient or participant data.</li>
          <li>Do not attempt to bypass usage limits, access other users&apos; data, or disrupt the service.</li>
        </ul>
        <h2>AI credits, plans and payments</h2>
        <ul>
          <li>AI features use credits. A request is charged for the processing it actually used. Failed requests are not charged. AI features may be limited or paused, for example when credits run out.</li>
          <li>The Free plan includes limited projects and a one-time introductory allowance of AI credits. Toprot Pro and prepaid credit packs are paid. Current prices, quotas and plan contents are shown on the <a href="/pricing">pricing page</a> and may change; a change does not affect a period you have already paid for.</li>
          <li>Toprot Pro is billed monthly and renews automatically each month until you cancel. You can cancel at any time from the Billing page; cancelling stops future charges and your plan stays active until the end of the period you have already paid for. Plan credits reset each billing period and unused plan credits do not carry over. You are never charged for anything you have not completed a payment for.</li>
          <li>Prepaid credit packs can be bought only while you have an active Toprot Pro subscription, and are separate from plan credits. Plan credits are used first. Purchased credits expire on the date shown at purchase and on your billing page, and expired credits cannot be used or refunded.</li>
          <li>A plan or credits are added only after the payment has been confirmed with the payment provider.</li>
          <li>Payments are processed by Dodo Payments, which acts as the merchant of record: it sells to you, collects any sales tax or VAT that applies, and issues your receipt. Prices on our site are shown before tax. ToProt does not see or store your payment details.</li>
          <li>If something goes wrong with a payment, or you believe you were charged in error, contact us and we will look into it. Refunds are considered case by case.</li>
        </ul>
        <h2>Availability</h2>
        <p>
          The service is provided as is during early access, and features may change or be withdrawn. See the{" "}
          <a href="/privacy">privacy policy</a> for how data is handled.
        </p>
      </Prose>
    </PageShell>
  );
}
