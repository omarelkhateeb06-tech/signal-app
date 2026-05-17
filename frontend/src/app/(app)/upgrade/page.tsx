"use client";

import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { useTier } from "@/hooks/useTier";

// Phase 12g — /upgrade placeholder. Lists Pro tier features +
// pricing. Payment integration is 12h (Stripe). The button reads
// "Coming soon" until 12h replaces it with the actual Stripe
// checkout flow.

const PRO_FEATURES: ReadonlyArray<string> = [
  "Personalized commentary at your role and seniority",
  "Briefed and Technical depth tiers on every story",
  "Unlimited stories per day",
  "Unlimited searches",
  "Daily digest email",
];

export default function UpgradePage(): JSX.Element {
  const tierQuery = useTier();
  const tier = tierQuery.data?.tier;
  const days = tierQuery.data?.trial_days_remaining ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-violet-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to feed
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upgrade to Pro</h1>
        <p className="text-base text-slate-600">
          The 10 stories per day that matter — with commentary tailored to your role.
        </p>
      </header>

      {tier === "pro_trial" && days !== null && (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          {days > 0
            ? `Your Pro trial has ${days} day${days === 1 ? "" : "s"} left.`
            : "Your Pro trial expires today."}
        </div>
      )}
      {tier === "free" && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Your Pro trial has expired. Upgrade to keep personalized commentary.
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Pro</h2>
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">$10/mo</div>
            <div className="text-xs text-slate-500">or $96/yr (save 20%)</div>
          </div>
        </div>

        <ul className="mb-6 space-y-2">
          {PRO_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
              <Check className="mt-0.5 h-4 w-4 flex-none text-violet-700" aria-hidden />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled
          aria-disabled
          className="w-full cursor-not-allowed rounded-md bg-violet-700/60 px-4 py-2 text-sm font-medium text-white"
        >
          Coming soon
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Payment integration ships in the next release.
        </p>
      </section>
    </div>
  );
}
