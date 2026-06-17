import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SIGNAL",
};

export default function PrivacyPage(): JSX.Element {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-ink-muted">Last updated: June 2026</p>
      </header>

      <div className="space-y-6 text-[15px] leading-relaxed text-ink">
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">1. Who We Are</h2>
          <p>
            SIGNAL is operated by Human Machine Automation LLC. This policy
            describes how we collect, use, and protect your personal
            information when you use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">2. Information We Collect</h2>
          <p>
            <strong>Account data:</strong> email address, password (hashed),
            name, and the role/sector preferences you provide during onboarding.
          </p>
          <p>
            <strong>Usage data:</strong> stories you read, save, or search for;
            commentary depth preferences; feed interaction events. Used solely
            to personalize your experience.
          </p>
          <p>
            <strong>Billing data:</strong> subscription status and Stripe
            customer/subscription IDs. We do not store raw card numbers — all
            payment processing is handled by Stripe.
          </p>
          <p>
            <strong>Technical data:</strong> IP address, browser type, and
            device information collected automatically via server logs.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">3. How We Use Your Information</h2>
          <p>We use your data to:</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-muted">
            <li>Provide and personalize the Service (role-aware commentary, ranked feed)</li>
            <li>Process payments and manage your subscription</li>
            <li>Send the daily digest email and transactional messages you opt into</li>
            <li>Improve the product through aggregate, anonymized analytics</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p>We do not sell your personal data to third parties.</p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">4. Third-Party Services</h2>
          <p>
            <strong>Stripe</strong> — payment processing. Stripe’s privacy
            policy governs data shared with them.
          </p>
          <p>
            <strong>SendGrid</strong> — transactional email delivery.
          </p>
          <p>
            <strong>Railway / Vercel</strong> — infrastructure hosting.
          </p>
          <p>
            <strong>Sentry</strong> — error monitoring (anonymized stack traces only).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">5. Cookies & Local Storage</h2>
          <p>
            We use a session JWT stored in your browser’s local storage for
            authentication. We set a cookie consent preference cookie so we
            don’t ask again. We do not use advertising or tracking cookies.
            Analytics events (upgrade funnel, feature usage) are first-party
            and tied to your account, not third-party ad networks.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">6. Data Retention</h2>
          <p>
            We retain your account data for as long as your account is active.
            If you delete your account, we will delete or anonymize your
            personal data within 30 days, except where retention is required
            by law (e.g., billing records).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">7. Your Rights</h2>
          <p>
            You may request access to, correction of, or deletion of your
            personal data at any time by emailing us. EU/UK residents have
            additional rights under GDPR/UK GDPR including the right to data
            portability and the right to object to processing.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">8. Security</h2>
          <p>
            Passwords are hashed with bcrypt. API keys are stored as HMAC-SHA256
            digests. All data is transmitted over TLS. We follow industry-standard
            practices but cannot guarantee absolute security.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">9. Children</h2>
          <p>
            The Service is not directed at anyone under 16. We do not knowingly
            collect personal data from children.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">10. Changes</h2>
          <p>
            We may update this policy. Material changes will be communicated
            via email or in-app notice before they take effect.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-ink">11. Contact</h2>
          <p>
            Privacy questions or data requests:{" "}
            <a href="mailto:omar.elkhateeb@hmautomation.llc" className="text-accent underline">
              omar.elkhateeb@hmautomation.llc
            </a>
          </p>
        </section>
      </div>

      <footer className="flex gap-4 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/terms" className="hover:text-ink hover:no-underline">Terms of Service</Link>
        <Link href="/refund" className="hover:text-ink hover:no-underline">Refund Policy</Link>
      </footer>
    </div>
  );
}
