"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createCheckoutSession, extractApiError, type BillingPlan } from "@/lib/api";
import { track } from "@/lib/analytics";

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

// A real, fully-rendered sample so a prospect can TASTE the product on
// the offer page instead of taking "tailored commentary" on faith.
const SAMPLE = {
  kicker: "Semiconductors · TSMC",
  role: "If you run a semis equity book",
  headline: "TSMC lifts 2026 capex to $52B on AI-accelerator demand",
  commentary:
    "The raise is almost entirely leading-edge (N2/A16) and advanced packaging — not mature nodes. That widens TSMC's lead on advanced capacity and is a tell on where hyperscaler accelerator orders actually land through 2027. Watch CoWoS: it's the binding constraint, and this capex says they're betting it stays that way.",
} as const;

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
          Never miss the one story that moves your market.
        </h1>
        <p className="mx-auto max-w-[46ch] text-base leading-relaxed text-ink-muted">
          Pro reads AI, Finance, and Semiconductors for you and tells you why
          each story matters to your role — in the time it takes to drink your
          coffee.
        </p>
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

      {/* Taste the product — a real rendered sample of role-tailored
          commentary, so "personalized" isn't taken on faith. */}
      <section className="space-y-3">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          See exactly what Pro reads for you
        </p>
        <Card flat className="space-y-3 border-t-2 border-t-sector-semis p-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-semis">
              {SAMPLE.kicker}
            </span>
          </div>
          <h3 className="font-display text-[19px] font-bold leading-snug text-ink">
            {SAMPLE.headline}
          </h3>
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
              {SAMPLE.role}
            </p>
            <p className="text-[14px] leading-[1.7] text-ink-muted">
              {SAMPLE.commentary}
            </p>
          </div>
          <p className="border-t border-line pt-2 text-[11px] text-ink-muted">
            Sample — your commentary is written for your role, seniority, and
            the sectors you follow.
          </p>
        </Card>
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

        <p className="mx-auto flex max-w-[44ch] items-center justify-center gap-1.5 text-xs leading-relaxed text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5 flex-none" aria-hidden />
          {trialAvailable
            ? "No charge today. If your first week doesn't surface a story you act on, cancel in one click — we won't ask why."
            : "Cancel in one click, anytime. Secure checkout via Stripe."}
        </p>
      </section>
    </div>
  );
}
