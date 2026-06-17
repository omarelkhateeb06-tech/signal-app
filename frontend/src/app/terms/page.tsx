import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — SIGNAL",
};

export default function TermsPage(): JSX.Element {
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
          Terms of Service
        </h1>
        <p className="text-sm text-ink-muted">Last updated: June 2026</p>
      </header>

      <div className="space-y-6 text-[15px] leading-relaxed text-ink">
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">1. Acceptance</h2>
          <p>
            By accessing or using SIGNAL ("Service"), operated by Human Machine
            Automation LLC ("we," "us," or "our"), you agree to be bound by
            these Terms. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">2. Description of Service</h2>
          <p>
            SIGNAL is a professional intelligence product that curates and
            summarizes news and analysis across the AI, Finance, and
            Semiconductor sectors. Content is provided for informational
            purposes only and does not constitute financial, legal, or
            investment advice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">3. Accounts</h2>
          <p>
            You must provide accurate information when creating an account. You
            are responsible for maintaining the security of your credentials.
            One account per person; do not share access.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">4. Subscriptions & Billing</h2>
          <p>
            Pro subscriptions are billed monthly or annually via Stripe. Your
            subscription renews automatically until cancelled. You may cancel
            at any time from your account settings; cancellation takes effect
            at the end of the current billing period.
          </p>
          <p>
            A 7-day free trial is available to new subscribers who have not
            previously held a trial. No charge is made during the trial period;
            cancelling before day 7 incurs no fee.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">5. Refunds</h2>
          <p>
            See our <Link href="/refund" className="text-accent underline">Refund Policy</Link>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">6. Acceptable Use</h2>
          <p>
            You may not scrape, redistribute, or resell Service content. You
            may not use the Service for any unlawful purpose or in any way that
            disrupts the Service for other users.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">7. Intellectual Property</h2>
          <p>
            All content generated or curated by SIGNAL — including AI-authored
            commentary and editorial synthesis — is the property of Human
            Machine Automation LLC. Third-party source content is attributed to
            its respective owners.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">8. Disclaimer</h2>
          <p>
            The Service is provided "as is" without warranty of any kind. We do
            not guarantee accuracy, completeness, or timeliness of any content.
            Nothing on SIGNAL constitutes financial or investment advice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Human Machine Automation LLC
            shall not be liable for any indirect, incidental, or consequential
            damages arising from your use of the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">10. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the State of Minnesota,
            without regard to conflict of law principles.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">11. Changes</h2>
          <p>
            We may update these Terms. Material changes will be notified via
            email or an in-app notice. Continued use after the effective date
            constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">12. Contact</h2>
          <p>
            Questions? Email{" "}
            <a href="mailto:omar.elkhateeb@hmautomation.llc" className="text-accent underline">
              omar.elkhateeb@hmautomation.llc
            </a>
          </p>
        </section>
      </div>

      <footer className="flex gap-4 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/privacy" className="hover:text-ink hover:no-underline">Privacy Policy</Link>
        <Link href="/refund" className="hover:text-ink hover:no-underline">Refund Policy</Link>
      </footer>
    </div>
  );
}
