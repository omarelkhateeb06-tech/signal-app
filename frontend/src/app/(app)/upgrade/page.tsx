"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createCheckoutSession, extractApiError, type BillingPlan } from "@/lib/api";
import { track } from "@/lib/analytics";
import { DepthDemo } from "@/components/upgrade/DepthDemo";

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

// Niche the dream outcome — three role-specific promises so "for whom"
// is answered concretely rather than "for professionals."
const SECTOR_OUTCOMES: ReadonlyArray<{ label: string; line: string }> = [
  {
    label: "AI",
    line: "The model release, paper, or raise your roadmap depends on — before it's everywhere.",
  },
  {
    label: "Finance",
    line: "The print, filing, or rate move that repositions a book — with the read on why.",
  },
  {
    label: "Semis",
    line: "The node, capex, or export-control shift that resets the supply chain — first.",
  },
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

  useEffect(() => {
    track("upgrade_viewed", { tier: tier ?? "unknown", trialAvailable });
  }, [tier, trialAvailable]);

  const startCheckout = async (plan: BillingPlan): Promise<void> => {
    track("checkout_started", { plan, trialAvailable });
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
          Walk into every room already knowing what moved your market.
        </h1>
        <p className="mx-auto max-w-[46ch] text-base leading-relaxed text-ink-muted">
          Pro reads AI, Finance, and Semiconductors for you and tells you why
          each story matters to your role — in the five minutes before your
          first coffee. Never miss the one that matters.
        </p>
        <div className="pt-1">
          <Button
            size="lg"
            onClick={() => startCheckout("monthly")}
            disabled={submitting !== null}
          >
            {submitting === "monthly" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              primaryLabel
            )}
          </Button>
        </div>
      </header>

      {/* Niche the promise — concrete, per-sector outcomes. */}
      <section className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
        {SECTOR_OUTCOMES.map((o) => (
          <div key={o.label} className="bg-surface p-4">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
              {o.label}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{o.line}</p>
          </div>
        ))}
      </section>

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

      {/* Taste the product — the depth toggle, demonstrated. Same story at
          all three depths so "personalized commentary" isn't taken on faith. */}
      <DepthDemo />

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

      {/* Trust strip — honest, verifiable signals (no fabricated proof). */}
      <section className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
        {[
          { icon: Clock, label: "Cancel in one click" },
          { icon: Lock, label: "Your reading stays private" },
          { icon: ShieldCheck, label: "Secure Stripe checkout" },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-xs text-ink-muted"
          >
            <Icon className="h-3.5 w-3.5 flex-none text-accent" aria-hidden />
            {label}
          </div>
        ))}
      </section>

      {/* Guarantee — a named promise with an honest mechanism, framed and
          placed right above the CTA where it does the most work. */}
      <section
        className="flex items-start gap-3 rounded-lg border px-5 py-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
          borderColor: "color-mix(in srgb, var(--accent) 28%, var(--line))",
        }}
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-accent" aria-hidden />
        <p className="text-[14px] leading-relaxed text-ink">
          <span className="font-semibold">The 7-day promise.</span>{" "}
          {trialAvailable
            ? "If VALO doesn't surface at least one story worth acting on in your first week, cancel in one click before day 7 — you're never charged. No email, no “are you sure,” no friction."
            : "Cancel in one click, anytime — no email, no “are you sure,” no friction. Your subscription ends the moment you say so."}
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

        <p className="text-xs text-ink-muted">
          {trialAvailable
            ? "No charge today · secure checkout via Stripe"
            : "Secure checkout via Stripe · cancel anytime"}
        </p>
      </section>
    </div>
  );
}
