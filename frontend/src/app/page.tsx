"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Bookmark, Check, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

// ─── Animation primitives ─────────────────────────────────────────────────────
// Bloomberg-speed: short, clean, no bounce. 300–360ms for reveals,
// 150ms for hovers. ease-soft-out (cubic-bezier(0.2, 0.8, 0.2, 1)).

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
};

const heroContainerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0 } },
};

// ─── LandingNav ───────────────────────────────────────────────────────────────

function LandingNav(): JSX.Element {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="font-display text-xl font-semibold tracking-tight text-ink">
          Valo
        </span>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-ink-muted no-underline transition-colors hover:text-ink hover:no-underline"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg no-underline transition-colors hover:bg-accent-hover hover:no-underline"
          >
            Start free trial
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─── MockStoryCard ────────────────────────────────────────────────────────────
// A faithful representation of a feed card with the depth-tier toggle.
// No screenshots or external images — pure JSX so it looks right immediately.

const DEPTH_TABS = ["Accessible", "Briefed", "Technical"] as const;

function MockStoryCard(): JSX.Element {
  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-line bg-surface shadow-card"
      style={{ maxWidth: 480 }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-white"
            style={{ backgroundColor: "var(--ai)" }}
          >
            AI
          </span>
          <span className="font-mono text-[11px] text-ink-muted">
            arXiv · 2h ago
          </span>
        </div>
        <Bookmark className="h-4 w-4 text-ink-muted/50" aria-hidden />
      </div>

      {/* Headline */}
      <div className="px-5 pb-3 pt-4">
        <h3 className="font-display text-[15px] font-semibold leading-snug text-ink">
          NVIDIA&apos;s H200 supply expansion reshapes AI training economics
          for enterprise customers
        </h3>
      </div>

      {/* Depth toggle */}
      <div className="flex gap-1 border-y border-line bg-bg px-5 py-2.5">
        {DEPTH_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={[
              "rounded-md px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors",
              tab === "Briefed"
                ? "bg-accent text-accent-fg"
                : "text-ink-muted",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Commentary preview */}
      <div className="px-5 pb-4 pt-3.5">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">For a senior ML engineer:</span>{" "}
          this supply expansion means training runs you&apos;ve been deferring
          due to H100 capacity constraints are now viable in Q1. Watch how
          hyperscaler spot pricing responds — that&apos;s your real signal.
        </p>
        <div className="mt-3 flex items-center gap-0.5 font-mono text-[11px] text-accent">
          Read full story
          <ChevronRight className="h-3 w-3" aria-hidden />
        </div>
      </div>
    </div>
  );
}

// ─── HeroSection ─────────────────────────────────────────────────────────────

function HeroSection(): JSX.Element {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-20 sm:pt-24">
      {/* Ambient gradient — teal pool top-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 55% 50% at 70% 0%, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-5xl">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_440px]">
          {/* Left column — text */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={heroContainerVariants}
            className="space-y-7"
          >
            <motion.p
              variants={itemVariants}
              className="font-mono text-[11px] uppercase tracking-[0.15em] text-accent"
            >
              Professional intelligence
            </motion.p>

            <motion.h1
              variants={itemVariants}
              className="font-display text-[50px] font-semibold leading-[1.08] tracking-tight text-ink sm:text-[62px]"
            >
              What to know.
              <br />
              Why it matters
              <br />
              to{" "}
              <span className="text-accent">you.</span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="max-w-md text-lg leading-relaxed text-ink-muted"
            >
              Personalized AI briefings across AI, Finance, and Semiconductors —
              with commentary tailored to your role and expertise level.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-4"
            >
              <Link
                href="/signup"
                className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-7 text-base font-medium text-accent-fg no-underline transition-colors hover:bg-accent-hover hover:no-underline"
              >
                Start your free trial
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/login"
                className="text-sm font-medium text-ink-muted no-underline transition-colors hover:text-ink hover:no-underline"
              >
                Already a member? Log in
              </Link>
            </motion.div>

            <motion.p
              variants={itemVariants}
              className="font-mono text-[11px] text-ink-muted/55"
            >
              7 days free · No credit card required
            </motion.p>
          </motion.div>

          {/* Right column — mock card */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: EASE, delay: 0.32 }}
            className="mx-auto lg:mx-0"
          >
            <MockStoryCard />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── ValuePropsSection ────────────────────────────────────────────────────────

interface ValueProp {
  readonly sectorColor: string;
  readonly sectorLabel: string;
  readonly title: string;
  readonly body: string;
  readonly footnote: string;
}

const VALUE_PROPS: ReadonlyArray<ValueProp> = [
  {
    sectorColor: "var(--ai)",
    sectorLabel: "Accessible · Briefed · Technical",
    title: "Personalized depth",
    body: "Commentary generated at three expertise tiers — matched to your role, seniority, and domain. The same story reads differently for a quant analyst and an AI researcher. Yours reads right for you.",
    footnote: "Set a default depth or toggle per story.",
  },
  {
    sectorColor: "var(--finance)",
    sectorLabel: "AI · Finance · Semiconductors",
    title: "Intelligence at the intersections",
    body: "These sectors aren't siloed — they're entangled. Chip constraints shape model economics. Capital flows rewrite research agendas. Valo covers the connections that matter and others miss.",
    footnote: "One briefing. Three sectors. No silo.",
  },
  {
    sectorColor: "var(--semis)",
    sectorLabel: "60+ sources · Ranked by role",
    title: "Signal, not noise",
    body: "~100 stories per day filtered from arXiv, HN, SEC EDGAR, Reuters, IEEE, and 55+ other sources. Ranked by relevance to your work — not by engagement bait or publish time.",
    footnote: "Curated editorially. Ranked for you.",
  },
];

function ValuePropsSection(): JSX.Element {
  return (
    <section className="border-t border-line bg-surface px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="grid gap-6 md:grid-cols-3"
        >
          {VALUE_PROPS.map((prop) => (
            <motion.div
              key={prop.title}
              variants={itemVariants}
              className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-6 transition-shadow duration-200 hover:shadow-card-hover"
              style={{
                borderLeftColor: prop.sectorColor,
                borderLeftWidth: "3px",
              }}
            >
              <p
                className="font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ color: prop.sectorColor }}
              >
                {prop.sectorLabel}
              </p>
              <h3 className="font-display text-xl font-semibold text-ink">
                {prop.title}
              </h3>
              <p className="flex-1 text-sm leading-relaxed text-ink-muted">
                {prop.body}
              </p>
              <p className="font-mono text-[11px] text-ink-muted/55">
                {prop.footnote}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── HowItWorksSection ────────────────────────────────────────────────────────

interface HowStep {
  readonly number: string;
  readonly color: string;
  readonly title: string;
  readonly body: string;
}

const HOW_STEPS: ReadonlyArray<HowStep> = [
  {
    number: "01",
    color: "var(--accent)",
    title: "Tell us who you are",
    body: "A 2-minute setup: your sectors, role, seniority, and what you want to stay ahead of. This is the only form you ever fill out.",
  },
  {
    number: "02",
    color: "var(--ai)",
    title: "Get your daily briefing",
    body: "Your personalized feed — ranked by relevance to your role. Refreshed daily from 60+ sources. No algorithmic decay, no engagement bait.",
  },
  {
    number: "03",
    color: "var(--finance)",
    title: "Go deeper, on your terms",
    body: "Toggle depth on any story. Accessible for context, Briefed for your working knowledge, Technical for the full picture. Commentary generated for your exact profile.",
  },
];

function HowItWorksSection(): JSX.Element {
  return (
    <section className="border-t border-line px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="space-y-14"
        >
          <motion.div variants={itemVariants} className="max-w-lg">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              How it works
            </p>
            <h2 className="font-display text-4xl font-semibold leading-tight text-ink">
              Three steps to a briefing built for you
            </h2>
          </motion.div>

          <div className="grid gap-10 sm:gap-8 md:grid-cols-3">
            {HOW_STEPS.map((step) => (
              <motion.div key={step.number} variants={itemVariants}>
                <div
                  className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl font-mono text-sm font-semibold text-white"
                  style={{ backgroundColor: step.color }}
                >
                  {step.number}
                </div>
                <h3 className="mb-2.5 font-display text-xl font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {step.body}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── SourcesSection ───────────────────────────────────────────────────────────

const SOURCES = [
  "arXiv",
  "Hacker News",
  "SEC EDGAR",
  "Reuters",
  "IEEE Spectrum",
  "MIT Tech Review",
  "The Information",
  "FT Alphaville",
  "Nature",
  "Seeking Alpha",
  "Bloomberg",
  "SEMI",
  "EE Times",
  "AnandTech",
  "Barron's",
  "The Transcript",
] as const;

function SourcesSection(): JSX.Element {
  return (
    <section className="border-t border-line bg-surface px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="space-y-12"
        >
          <motion.div variants={itemVariants} className="text-center">
            <p
              className="font-mono text-[64px] font-medium tabular-nums leading-none text-ink"
            >
              60<span className="text-accent">+</span>
            </p>
            <p className="mt-2.5 text-base text-ink-muted">
              sources tracked across AI, Finance, and Semiconductors
            </p>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="flex flex-wrap justify-center gap-2"
          >
            {SOURCES.map((source) => (
              <span
                key={source}
                className="rounded-full border border-line bg-bg px-3 py-1 font-mono text-[12px] text-ink-muted"
              >
                {source}
              </span>
            ))}
            <span className="rounded-full border border-line/40 bg-bg px-3 py-1 font-mono text-[12px] text-ink-muted/40">
              +44 more
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── PricingSection ───────────────────────────────────────────────────────────

const FREE_FEATURES = [
  "15 stories per day",
  "Accessible depth only",
  "General commentary",
  "3 searches per day",
] as const;

const PRO_FEATURES = [
  "Unlimited stories",
  "All depth tiers — Accessible · Briefed · Technical",
  "Personalized role-aware commentary",
  "Unlimited search",
  "Daily digest email",
] as const;

function PricingSection(): JSX.Element {
  return (
    <section className="border-t border-line px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="space-y-14"
        >
          <motion.div variants={itemVariants} className="text-center">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              Pricing
            </p>
            <h2 className="font-display text-4xl font-semibold text-ink">
              Simple. No tiers to decode.
            </h2>
          </motion.div>

          <motion.div
            variants={containerVariants}
            className="mx-auto grid max-w-2xl gap-5 md:grid-cols-2"
          >
            {/* Free card */}
            <motion.div
              variants={itemVariants}
              whileHover={{ y: -3, transition: { duration: 0.15, ease: EASE } }}
              className="flex flex-col gap-6 rounded-xl border border-line bg-bg p-7"
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                  Free
                </p>
                <p className="mt-1.5 font-display text-[32px] font-semibold leading-none text-ink">
                  $0
                </p>
                <p className="mt-1 text-sm text-ink-muted">forever</p>
              </div>

              <ul className="flex-1 space-y-3">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-ink">
                    <Check
                      className="mt-0.5 h-4 w-4 flex-none text-ink-muted"
                      aria-hidden
                    />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-surface text-sm font-medium text-ink no-underline transition-colors hover:bg-bg hover:no-underline"
              >
                Get started free
              </Link>
            </motion.div>

            {/* Pro card */}
            <motion.div
              variants={itemVariants}
              whileHover={{ y: -3, transition: { duration: 0.15, ease: EASE } }}
              className="flex flex-col gap-6 rounded-xl border bg-surface p-7"
              style={{
                borderColor: "color-mix(in srgb, var(--accent) 40%, var(--line))",
                boxShadow:
                  "0 1px 2px rgba(26,24,22,0.04), 0 4px 16px rgba(10,109,121,0.09)",
              }}
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-accent">
                  Pro
                </p>
                <p className="mt-1.5 font-display text-[32px] font-semibold leading-none text-ink">
                  $10
                </p>
                <p className="mt-1 text-sm text-ink-muted">per month</p>
              </div>

              <ul className="flex-1 space-y-3">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-ink">
                    <Check
                      className="mt-0.5 h-4 w-4 flex-none text-accent"
                      aria-hidden
                    />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="space-y-2">
                <Link
                  href="/signup"
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-fg no-underline transition-colors hover:bg-accent-hover hover:no-underline"
                >
                  Start 7-day free trial
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <p className="text-center font-mono text-[11px] text-ink-muted/55">
                  No credit card required
                </p>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── LandingFooter ────────────────────────────────────────────────────────────

function LandingFooter(): JSX.Element {
  return (
    <footer className="border-t border-line bg-surface px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="font-display text-base font-semibold text-ink">Valo</p>
          <p className="mt-1 text-sm text-ink-muted">
            Built for professionals who need signal, not noise.
          </p>
        </div>
        <nav
          className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm sm:justify-end"
          aria-label="Footer navigation"
        >
          <Link
            href="/login"
            className="text-ink-muted no-underline transition-colors hover:text-ink hover:no-underline"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-ink-muted no-underline transition-colors hover:text-ink hover:no-underline"
          >
            Sign up
          </Link>
          <span className="cursor-default text-ink-muted/35" aria-hidden>
            Terms
          </span>
          <span className="cursor-default text-ink-muted/35" aria-hidden>
            Privacy
          </span>
          <span className="cursor-default text-ink-muted/35" aria-hidden>
            Contact
          </span>
        </nav>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage(): JSX.Element {
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.replace("/feed");
    }
  }, [hasHydrated, isAuthenticated, router]);

  return (
    <div className="min-h-dvh bg-bg">
      <LandingNav />
      <main>
        <HeroSection />
        <ValuePropsSection />
        <HowItWorksSection />
        <SourcesSection />
        <PricingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
