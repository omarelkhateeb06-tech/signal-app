import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy — SIGNAL",
};

export default function RefundPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-[680px] space-y-8 px-4 py-14">
      <header className="space-y-2">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-ink hover:no-underline"
        >
          ← SIGNAL
        </Link>
        <h1 className="font-display text-[34px] font-bold tracking-tight text-ink">
          Refund Policy
        </h1>
        <p className="text-sm text-ink-muted">Last updated: June 2026</p>
      </header>

      <div className="space-y-6 text-[15px] leading-relaxed text-ink">
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">7-Day Free Trial</h2>
          <p>
            New Pro subscribers receive a 7-day free trial. No charge is made
            during the trial period. Cancelling before day 7 incurs no fee and
            requires no email — cancel in one click from Settings.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">Monthly Subscriptions</h2>
          <p>
            If you cancel within <strong>72 hours</strong> of your first paid
            charge (after the trial ends or for non-trial subscribers), email us
            for a full refund. Cancellations after 72 hours take effect at the
            end of the current billing period — no partial-month refunds are
            issued.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">Annual Subscriptions</h2>
          <p>
            Annual plans may be refunded in full within <strong>14 days</strong>{" "}
            of purchase if you have not substantially used the Service (fewer
            than 5 story views after the trial). Email us with your account
            email and we will process the refund within 5 business days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">How to Request a Refund</h2>
          <p>
            Email{" "}
            <a href="mailto:omar.elkhateeb@hmautomation.llc" className="text-accent underline">
              omar.elkhateeb@hmautomation.llc
            </a>{" "}
            with the subject line “Refund request” and your account email
            address. We will respond within 2 business days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">Exceptions</h2>
          <p>
            We reserve the right to decline refund requests where there is
            evidence of abuse of the trial or refund policy (e.g., repeated
            subscribe-and-refund patterns).
          </p>
        </section>
      </div>

      <footer className="flex gap-4 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/terms" className="hover:text-ink hover:no-underline">Terms of Service</Link>
        <Link href="/privacy" className="hover:text-ink hover:no-underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
