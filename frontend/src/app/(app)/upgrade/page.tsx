"use client";

import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Phase 12g — /upgrade placeholder. Phase 12j — restyled as the
// marketing-style surface in the design brief: serif headline,
// two-column Free-vs-Pro comparison cards, prominent pricing, single
// large CTA. Payment integration is 12h.

const FREE_FEATURES: ReadonlyArray<string> = [
  "15 stories per day",
  "Accessible depth only",
  "General commentary",
  "3 searches per day",
];

const PRO_FEATURES: ReadonlyArray<string> = [
  "Unlimited stories",
  "All depth tiers — Accessible · Briefed · Technical",
  "Personalized commentary",
  "Unlimited search",
  "Daily digest email",
];

function PlanCard({
  name,
  features,
  emphasized,
}: {
  name: string;
  features: ReadonlyArray<string>;
  emphasized?: boolean;
}): JSX.Element {
  return (
    <Card
      flat={!emphasized}
      className="flex flex-col gap-4 p-6"
      style={
        emphasized
          ? {
              borderColor: "color-mix(in srgb, var(--accent) 35%, var(--line))",
              boxShadow: "0 1px 2px rgba(26,24,22,0.04), 0 4px 12px rgba(10,109,121,0.07)",
            }
          : undefined
      }
    >
      <header>
        <p
          className={
            emphasized
              ? "font-mono text-[11px] uppercase tracking-[0.12em] text-accent"
              : "font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted"
          }
        >
          {emphasized ? "Recommended" : "Today"}
        </p>
        <h3 className="mt-1 font-display text-xl font-semibold text-ink">{name}</h3>
      </header>
      <ul className="space-y-2">
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

  const ctaLabel = trialAvailable
    ? "Start Free Trial — 7 days free"
    : "Coming Soon";

  return (
    <div className="mx-auto max-w-[600px] space-y-10 py-8">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink hover:no-underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to briefing
      </Link>

      <header className="space-y-3 text-center">
        <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight text-ink">
          Read smarter, not more.
        </h1>
        <p className="text-base leading-relaxed text-ink-muted">
          SIGNAL Pro gives you personalized intelligence tailored to your role
          and expertise.
        </p>
      </header>

      {tier === "pro_trial" && days !== null && (
        <div
          className="rounded-md border px-4 py-3 text-center text-sm text-ink"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--accent) 6%, var(--surface))",
            borderColor: "color-mix(in srgb, var(--accent) 25%, var(--line))",
          }}
        >
          {days > 0
            ? `Your trial expires in ${days} day${days === 1 ? "" : "s"}.`
            : "Your trial expires today."}
        </div>
      )}
      {tier === "free" && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-center text-sm text-ink-muted">
          Your trial has ended. Upgrade to keep personalized commentary.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <PlanCard name="Free" features={FREE_FEATURES} />
        <PlanCard name="Pro" features={PRO_FEATURES} emphasized />
      </section>

      <section className="space-y-4 text-center">
        <div>
          <p className="font-display text-[28px] font-semibold text-ink">$10/month</p>
          <p className="text-sm text-ink-muted">or $96/year — save 20%</p>
        </div>
        <Button size="lg" disabled className="w-full">
          {ctaLabel}
        </Button>
        <p className="text-xs text-ink-muted">
          Payment integration ships in the next release. Cancel anytime.
        </p>
      </section>
    </div>
  );
}
