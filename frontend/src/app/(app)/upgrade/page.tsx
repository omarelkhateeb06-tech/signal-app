"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, ShieldCheck } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createCheckoutSession, extractApiError, type BillingPlan } from "@/lib/api";

// Phase 12g — /upgrade. Phase 12v — rebuilt as a real offer surface on
// the Value Equation (dream outcome × likelihood ÷ time × effort) with
// price anchoring (cost-of-inaction + analyst-hour comparison) and risk
// reversal. Billing is live: the CTA opens Stripe Checkout.

const FREE_FEATURES: ReadonlyArray<string> = [
  "15 stories per day",
  "Plain-English depth only",
  "Generic commentary",
  "3 searches per day",
];

const PRO_FEATURES: ReadonlyArray<string> = [
  "Unlimited stories across all three sectors",
  "Every depth — Accessible · Briefed · Technical",
  "Commentary tailored to your role and seniority",
  "Unlimited search",
  "Daily 7am intelligence digest",
];

function PlanCard({
  name,
  price,
  features,
  emphasized,
}: {
  name: string;
  price: string;
  features: ReadonlyArray<string>;
  emphasized?: boolean;
}): JSX.Element {
  return (
    <Card
      flat={!emphasized}
      sectorAccent={null}
      className="flex flex-col gap-4 p-6"
      style={
        emphasized
          ? {
              borderColor: "color-mix(in srgb, var(--accent) 40%, var(--line))",
              boxShadow:
                "0 1px 2px rgba(26,24,22,0.04), 0 6px 20px color-mix(in srgb, var(--accent) 14%, transparent)",
            }
          : undefined
      }
    >
      <header className="space-y-1">
        <p
          className={
            emphasized
              ? "font-mono text-[11px] uppercase tracking-[0.12em] text-accent"
              : "font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted"
          }
        >
          {emphasized ? "Pro — recommended" : "Free — today"}
        </p>
        <div className="flex items-baseline gap-1.5">
          <h3 className="font-display text-2xl font-bold text-ink">{name}</h3>
          <span className="text-sm text-ink-muted">{price}</span>
        </div>
      </header>
      <ul className="space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-ink">
            <Check
              className={`mt-0.5 h-4 w-4 flex-none ${emphasized ? "text-accent" : "text-ink-muted"}`}
              aria-hidden
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function UpgradePage(): JSX.Element {
  const tierQuery = useTier();
  const tier = tierQuery.data?.tier;
  const days = tierQuery.data?.trial_days_remaining ?? null;
  const trialAvailable = tierQuery.data?.trial_available ?? false;

  const [submitting, setSubmitting] = useState<BillingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (plan: BillingPlan): Promise<void> => {
    setSubmitting(plan);
    setError(null);
    try {
      const { url } = await createCheckoutSession(plan);
      window.location.href = url;
    } catch (e) {
      setError(extractApiError(e, "Couldn't open checkout. Please try again."));
      setSubmitting(null);
    }
  };

  const primaryLabel = trialAvailable
    ? "Start 7-day free trial"
    : "Subscribe to Pro — $10/month";

  return (
    <div className="mx-auto max-w-[620px] space-y-10 py-8">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink hover:no-underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to briefing
      </Link>

      <header className="space-y-3 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          VALO Pro
        </p>
        <h1 className="font-display text-[38px] font-bold leading-[1.06] tracking-tight text-ink">
          Never miss the one story that moves your market.
        </h1>
        <p className="mx-auto max-w-[46ch] text-base leading-relaxed text-ink-muted">
          Pro reads AI, Finance, and Semiconductors for you and tells you why
          each story matters to your role — in the time it takes to drink your
          coffee.
        </p>
      </header>

      {tier === "pro_trial" && days !== null && (
        <div
          className="rounded-md border px-4 py-3 text-center text-sm text-ink"
          style={{
            backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
            borderColor: "color-mix(in srgb, var(--accent) 25%, var(--line))",
          }}
        >
          {days > 0
            ? `You're on the Pro trial — ${days} day${days === 1 ? "" : "s"} left. Lock it in below.`
            : "Your Pro trial ends today — keep it going below."}
        </div>
      )}
      {tier === "free" && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-center text-sm text-ink-muted">
          You&apos;re on Free. Upgrade to bring back personalized commentary and
          the full feed.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <PlanCard name="Free" price="$0" features={FREE_FEATURES} />
        <PlanCard name="Pro" price="$10/mo" features={PRO_FEATURES} emphasized />
      </section>

      {/* Price anchor — cost of inaction + the analyst-hour comparison. The
          point is to move the decision off "$10" and onto perceived value. */}
      <section
        className="rounded-lg border px-5 py-4 text-center"
        style={{
          backgroundColor: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
          borderColor: "color-mix(in srgb, var(--accent) 20%, var(--line))",
        }}
      >
        <p className="text-[15px] leading-relaxed text-ink">
          One missed signal costs more than a year of Pro.{" "}
          <span className="text-ink-muted">
            At $10/month, Pro is less than a single analyst-hour — and it works
            every morning before you do.
          </span>
        </p>
      </section>

      <section className="space-y-4 text-center">
        <div>
          <p className="font-display text-[30px] font-bold text-ink">
            $10<span className="text-lg font-normal text-ink-muted">/month</span>
          </p>
          <p className="text-sm text-ink-muted">7 days free, then $10/month.</p>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={() => startCheckout("monthly")}
          disabled={submitting !== null}
        >
          {submitting === "monthly" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            primaryLabel
          )}
        </Button>

        <button
          type="button"
          onClick={() => startCheckout("annual")}
          disabled={submitting !== null}
          className="text-sm text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-60"
        >
          {submitting === "annual"
            ? "Opening checkout…"
            : "Prefer annual? Pay $96/year — save 20%"}
        </button>

        {error && (
          <p className="text-sm text-err" role="alert">
            {error}
          </p>
        )}

        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {trialAvailable
            ? "No charge today. Cancel anytime during your trial."
            : "Cancel anytime. Secure checkout via Stripe."}
        </p>
      </section>
    </div>
  );
}
