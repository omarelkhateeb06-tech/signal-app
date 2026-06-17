"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { DepthToggle } from "@/components/stories/DepthToggle";
import { useOnboardingStore } from "@/store/onboardingStore";
import {
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_SIZES,
  DEPTH_PREFERENCES,
  GOALS,
  HOW_DID_YOU_HEAR,
  ROLES,
  SECTORS,
  SENIORITIES,
  TOPICS_BY_SECTOR,
  DEFAULT_GOAL,
} from "@/lib/onboarding";
import { getDomainOptionsForSectors } from "@/lib/onboarding/domainOptions";
import { useOnboardingComplete } from "@/hooks/useProfile";
import {
  markOnboardingCompletedInSession,
  useOnboardingNav,
  useScreenViewEvent,
} from "@/hooks/useOnboardingNav";
import { extractApiError } from "@/lib/api";
import type { DepthPreference, DigestPreference } from "@/types/auth";

// Dispatcher — parse the [step] param and render the matching screen.
// Invalid step -> 404 (notFound renders the app's root not-found).
export default function OnboardingStepPage(): JSX.Element {
  const params = useParams<{ step: string }>();
  const step = Number(params.step);
  if (!Number.isInteger(step) || step < 1 || step > 7) {
    notFound();
  }

  switch (step) {
    case 1: return <Screen1 />;
    case 2: return <Screen2 />;
    case 3: return <Screen3 />;
    case 4: return <Screen4 />;
    case 5: return <Screen5 />;
    case 6: return <Screen6 />;
    case 7: return <Screen7 />;
    default: notFound();
  }
}

// ---------- Screen 1: sectors ----------

function Screen1(): JSX.Element {
  const { sectors, setSectors } = useOnboardingStore();
  useScreenViewEvent(1);
  const nav = useOnboardingNav(1);

  const toggle = (value: string): void => {
    setSectors(
      sectors.includes(value)
        ? sectors.filter((v) => v !== value)
        : [...sectors, value],
    );
  };

  return (
    <OnboardingShell
      step={1}
      title="What sectors interest you?"
      description="Pick one or more. You can change this later in settings."
      canContinue={sectors.length >= 1}
      onContinue={() => nav.goNext(2)}
    >
      <div className="space-y-3">
        {SECTORS.map((s) => {
          const checked = sectors.includes(s.value);
          // Phase 12j — sector accent color on the selected state.
          // Each sector card lights up with its design-system color
          // so the user previews the in-app sector treatment.
          const sectorVar =
            s.value === "ai"
              ? "var(--ai)"
              : s.value === "finance"
                ? "var(--finance)"
                : s.value === "semiconductors"
                  ? "var(--semis)"
                  : "var(--accent)";
          return (
            <label
              key={s.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors"
              style={
                checked
                  ? {
                      borderColor: sectorVar,
                      backgroundColor: `color-mix(in srgb, ${sectorVar} 6%, var(--surface))`,
                      boxShadow: `inset 0 0 0 1px ${sectorVar}`,
                    }
                  : { borderColor: "var(--line)" }
              }
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={checked}
                onChange={() => toggle(s.value)}
              />
              <div>
                <p className="font-medium text-ink">{s.label}</p>
                <p className="text-sm text-ink-muted">{s.description}</p>
              </div>
            </label>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 2: role + domain ----------

// Phase 12c: Screen 2 expanded to capture `domain` (field-within-
// sector) alongside role. Role stays as a radio grid (9 options);
// domain is a native dropdown because the union of per-sector options
// can reach ~50 entries when the user has all three sectors selected.
// Domain options are filtered by the sectors the user picked on
// Screen 1, with "General / Not sure" always pinned at the bottom.
//
// If the user navigates back to Screen 1, changes sectors, then
// returns here, a previously-chosen domain may no longer be in the
// filtered list. We reset `domain` to null in that case. Since #18 made
// the field optional this no longer blocks Continue — it just clears a
// now-invalid pick. This runs once per sectors change, not per render.

function Screen2(): JSX.Element {
  const {
    sectors,
    role,
    setRole,
    domain,
    setDomain,
    company,
    setCompany,
    companySize,
    setCompanySize,
  } = useOnboardingStore();
  useScreenViewEvent(2);
  const nav = useOnboardingNav(2);

  const domainOptions = useMemo(
    () => getDomainOptionsForSectors(sectors),
    [sectors],
  );

  // If the previously-selected domain is no longer a valid option
  // (because sectors changed), clear it so the user re-picks. Safe
  // to run as an effect: setDomain is a no-op when the value already
  // matches, and the dependency on the options array only changes
  // when sectors change.
  useEffect(() => {
    if (domain === null) return;
    const stillValid = domainOptions.some((opt) => opt.value === domain);
    if (!stillValid) {
      // Clear — typed as `string` setter, so use empty + treat null
      // below in canContinue. (Store default is null; passing '' would
      // drift the type. Cast through unknown to bypass the setter's
      // string requirement without widening it.)
      (setDomain as (v: string | null) => void)(null);
    }
  }, [domain, domainOptions, setDomain]);

  // Issue #18 — field of work is OPTIONAL. Only role is required to advance.
  const canContinue = role !== null && role.length > 0;

  return (
    <OnboardingShell
      step={2}
      title="Tell us about your work"
      description="Role and field. We use both to tailor commentary — the field question sharpens the signal beyond role alone."
      canContinue={canContinue}
      onContinue={() => nav.goNext(3)}
      onBack={nav.goBack}
    >
      <div className="space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Your role
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROLES.map((r) => {
              const checked = role === r.value;
              return (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                    checked ? "border-accent ring-1 ring-accent/40" : "border-line hover:border-ink-muted hover:bg-bg"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => setRole(r.value)}
                  />
                  <span className="font-medium">{r.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            What field do you work in?{" "}
            <span className="font-normal normal-case text-ink-muted">
              — optional
            </span>
          </legend>
          <p className="text-sm text-ink-muted">
            Pick the closest match, or skip it. Options are scoped to your
            selected sectors — choose &ldquo;General / Not sure&rdquo; if
            nothing fits.
          </p>
          <select
            className="w-full rounded-md border bg-background p-3 font-medium"
            value={domain ?? ""}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="">No specific field</option>
            {domainOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </fieldset>

        {/* Phase 12w — optional firmographics. Never gate Continue. */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Company{" "}
            <span className="font-normal normal-case text-ink-muted">
              — optional
            </span>
          </legend>
          <input
            type="text"
            className="w-full rounded-md border bg-background p-3 font-medium"
            placeholder="Where you work"
            maxLength={COMPANY_NAME_MAX_LENGTH}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Company size{" "}
            <span className="font-normal normal-case text-ink-muted">
              — optional
            </span>
          </legend>
          <select
            className="w-full rounded-md border bg-background p-3 font-medium"
            value={companySize}
            onChange={(e) => setCompanySize(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {COMPANY_SIZES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </fieldset>
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 3: seniority ----------

function Screen3(): JSX.Element {
  const { seniority, setSeniority } = useOnboardingStore();
  useScreenViewEvent(3);
  const nav = useOnboardingNav(3);

  return (
    <OnboardingShell
      step={3}
      title="How senior are you?"
      description="Helps us calibrate depth and context."
      canContinue={seniority !== null}
      onContinue={() => nav.goNext(4)}
      onBack={nav.goBack}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SENIORITIES.map((s) => {
          const checked = seniority === s.value;
          return (
            <label
              key={s.value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                checked ? "border-accent ring-1 ring-accent/40" : "border-line hover:border-ink-muted hover:bg-bg"
              }`}
            >
              <input
                type="radio"
                name="seniority"
                value={s.value}
                className="h-4 w-4"
                checked={checked}
                onChange={() => setSeniority(s.value)}
              />
              <span className="font-medium">{s.label}</span>
            </label>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 4: topics (skippable) ----------
//
// Phase 12c reordered the flow so topics runs directly after seniority
// (used to be Screen 5). The depth selector moved to *after* goals —
// rationale: depth is a presentation preference that users anchor more
// confidently once they've already declared what they care about. See
// Screen 6 for the depth body.

function Screen4(): JSX.Element {
  const { sectors, topics, setTopics } = useOnboardingStore();
  useScreenViewEvent(4);
  const nav = useOnboardingNav(4);

  // Build the master list of all valid (sector, topic) pairs for the
  // currently selected sectors. Skipping fills `topics` with this full
  // set — the "I want to see everything in my sectors" interpretation.
  const allPairs = useMemo(() => {
    return sectors.flatMap((sector) => {
      const sectorTopics = TOPICS_BY_SECTOR[sector] ?? [];
      return sectorTopics.map((t) => ({ sector, topic: t.value }));
    });
  }, [sectors]);

  const isSelected = (sector: string, topic: string): boolean =>
    topics.some((t) => t.sector === sector && t.topic === topic);

  const toggle = (sector: string, topic: string): void => {
    setTopics(
      isSelected(sector, topic)
        ? topics.filter((t) => !(t.sector === sector && t.topic === topic))
        : [...topics, { sector, topic }],
    );
  };

  const handleSkip = (): void => {
    // Fill the store BEFORE nav.skip emits + routes; skip's event goes
    // out with the router.push so the order is stable in tests.
    setTopics(allPairs);
    nav.skip(5);
  };

  return (
    <OnboardingShell
      step={4}
      title="Any topics you especially care about?"
      description="Pick any — or skip and we'll show you everything in your sectors."
      canContinue={true}
      onContinue={() => nav.goNext(5)}
      onSkip={handleSkip}
      onBack={nav.goBack}
    >
      <div className="space-y-6">
        {sectors.length === 0 && (
          <p className="text-sm text-ink-muted">
            Pick a sector on step 1 first.
          </p>
        )}
        {sectors.map((sector) => {
          const sectorTopics = TOPICS_BY_SECTOR[sector] ?? [];
          const sectorLabel = SECTORS.find((s) => s.value === sector)?.label ?? sector;
          return (
            <div key={sector} className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
                {sectorLabel}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sectorTopics.map((t) => {
                  const checked = isSelected(sector, t.value);
                  return (
                    <label
                      key={`${sector}:${t.value}`}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                        checked ? "border-accent ring-1 ring-accent/40" : "border-line hover:border-ink-muted hover:bg-bg"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggle(sector, t.value)}
                      />
                      <span className="text-sm">{t.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 5: goals (skippable) ----------
//
// Phase 12c: goals moved up one slot (was Screen 6) so the depth
// selector can follow it at Screen 6. The skip default is unchanged —
// still [DEFAULT_GOAL] — only the downstream route target moves.

function Screen5(): JSX.Element {
  const { goals, setGoals } = useOnboardingStore();
  useScreenViewEvent(5);
  const nav = useOnboardingNav(5);

  const toggle = (value: string): void => {
    setGoals(
      goals.includes(value)
        ? goals.filter((v) => v !== value)
        : [...goals, value],
    );
  };

  const handleSkip = (): void => {
    // Per spec: Skip submits the default single-goal list.
    setGoals([DEFAULT_GOAL]);
    nav.skip(6);
  };

  return (
    <OnboardingShell
      step={5}
      title="What do you want to get out of SIGNAL?"
      description="Select any that apply — or skip to use the default."
      canContinue={goals.length >= 1}
      onContinue={() => nav.goNext(6)}
      onSkip={handleSkip}
      onBack={nav.goBack}
    >
      <div className="space-y-2">
        {GOALS.map((g) => {
          const checked = goals.includes(g.value);
          return (
            <label
              key={g.value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                checked ? "border-accent ring-1 ring-accent/40" : "border-line hover:border-ink-muted hover:bg-bg"
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={checked}
                onChange={() => toggle(g.value)}
              />
              <span className="font-medium">{g.label}</span>
            </label>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 6: depth preference ----------
//
// Phase 12c: depth selector moved from Screen 4 to Screen 6. Rationale
// in the phase prompt — users calibrate depth more confidently after
// they've declared sectors, topics, and goals. Wire shape is unchanged
// (depth_preference still ships as part of the /onboarding/complete
// payload); only the screen position moved, so the only source-level
// changes are the hook args + the next-step target.

function Screen6(): JSX.Element {
  const { depthPreference, setDepthPreference } = useOnboardingStore();
  useScreenViewEvent(6);
  const nav = useOnboardingNav(6);

  // Phase 12j — depth selection now uses the DepthToggle component
  // so users learn the in-app interaction immediately. lockHigherTiers
  // is false here: onboarding lets the user pick any depth (their tier
  // gate fires at request time, not at preference-set time). Default
  // to "accessible" if nothing's set so the toggle always has a
  // controlled value.
  const value = (depthPreference ?? "accessible") as DepthPreference;

  return (
    <OnboardingShell
      step={6}
      title="How deep do you want to go?"
      description="Pick the depth you'd like by default. You can switch on any story, and your tier may gate the higher tiers."
      canContinue={true}
      onContinue={() => nav.goNext(7)}
      onBack={nav.goBack}
    >
      <div className="flex justify-center py-2">
        <DepthToggle
          value={value as "accessible" | "briefed" | "technical"}
          onSelect={(d) => setDepthPreference(d as DepthPreference)}
          lockHigherTiers={false}
        />
      </div>
      <div className="mt-4 space-y-2 text-center text-sm text-ink-muted">
        {DEPTH_PREFERENCES.find((d) => d.value === value)?.description}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 7: digest + timezone; submits. ----------

function Screen7(): JSX.Element {
  const router = useRouter();
  const store = useOnboardingStore();
  useScreenViewEvent(7);
  const nav = useOnboardingNav(7);
  const complete = useOnboardingComplete();
  const [error, setError] = useState<string | null>(null);

  // One-time timezone detection — the screen_view event is handled by
  // useScreenViewEvent above.
  useEffect(() => {
    if (!store.timezone && typeof Intl !== "undefined") {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) store.setTimezone(tz);
      } catch {
        // Ignore — server-side zod requires a string, so we fall back
        // to UTC below at submit time if detection failed.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canContinue = store.digestPreference !== null;

  const submit = async (): Promise<void> => {
    setError(null);
    // Resolve topics: empty means "Skip was never pressed AND no
    // selections were made" — still treat as all-topics for the
    // user's selected sectors.
    const resolvedTopics =
      store.topics.length > 0
        ? store.topics
        : store.sectors.flatMap((sector) => {
            const pairs = TOPICS_BY_SECTOR[sector] ?? [];
            return pairs.map((t) => ({ sector, topic: t.value }));
          });

    const resolvedGoals = store.goals.length > 0 ? store.goals : [DEFAULT_GOAL];

    // Fire screen_completed(7) synchronously before the async
    // mutation. On a 7-screen flow with two re-Continues the funnel
    // expects `screen_completed: 9` but we were seeing 8 — screens
    // 1-6 emit via nav.goNext, but Screen 7's Finish path called
    // complete.mutateAsync + router.push('/feed') and never matched
    // the goNext shape, so screen 7's completion event was just
    // missing. Emitting here (not inside the try after success) means
    // an attempted-but-failed finish still records the user's intent
    // to complete, which is the right shape for the funnel.
    // (Second fix-it: Defect 2.)
    nav.emitCompleted();

    try {
      await complete.mutateAsync({
        sectors: store.sectors,
        role: store.role ?? "",
        // Phase 12c — domain in the completion payload. Issue #18 made it
        // OPTIONAL: Screen 2 no longer gates Continue on domain, so the
        // coalescing branch fires whenever the user skips the field. The
        // empty string is the wire sentinel for "skipped"; the backend
        // accepts it (zod refine allows "") and maps it to null at write.
        domain: store.domain ?? "",
        seniority: store.seniority ?? "",
        depth_preference: store.depthPreference,
        topics: resolvedTopics,
        goals: resolvedGoals,
        digest_preference: (store.digestPreference ?? "none") as DigestPreference,
        timezone: store.timezone ?? "UTC",
        // Phase 12w — optional firmographics (Screen 2) + acquisition source
        // (Screen 7). "" when skipped; the backend maps it to null.
        company: store.company,
        company_size: store.companySize,
        how_did_you_hear: store.howDidYouHear,
      });
      // Synchronously latch "completed" in sessionStorage BEFORE the
      // router.push to /feed. The abandon beacon (attached in the
      // onboarding layout) checks this flag at fire time and skips
      // emission — without it, any beforeunload that fires during the
      // Finish → /feed transition (tab reload on /feed before the
      // profile refetch settles, browser/extension flushing listeners
      // eagerly) would mis-attribute a completed user as abandoning.
      // (Second fix-it: Defect 1.)
      markOnboardingCompletedInSession();
      store.reset();
      router.push("/feed");
    } catch (err) {
      setError(extractApiError(err, "Could not complete onboarding"));
    }
  };

  return (
    <OnboardingShell
      step={7}
      title="Receive a daily digest email?"
      description="A short roundup of the day's top stories, sent every morning."
      canContinue={canContinue}
      isSubmitting={complete.isPending}
      continueLabel="Finish"
      onContinue={submit}
      onBack={nav.goBack}
      error={error}
    >
      {/* Phase 12j — Pro-only digest is a single Yes/No toggle. The
          legacy morning/evening/none triple is reduced to "daily"
          (the canonical Pro cadence post-12i) vs "never". Default
          to "daily" for fresh signups; users can flip off here. */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { value: "morning", label: "Yes, daily" },
          { value: "none", label: "No, thanks" },
        ].map((opt) => {
          const checked = store.digestPreference === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center justify-center gap-3 rounded-md border p-4 transition-colors ${
                checked
                  ? "border-accent ring-1 ring-accent/40"
                  : "border-line hover:border-ink-muted hover:bg-bg"
              }`}
            >
              <input
                type="radio"
                name="digest"
                value={opt.value}
                className="sr-only"
                checked={checked}
                onChange={() =>
                  store.setDigestPreference(opt.value as DigestPreference)
                }
              />
              <span className="font-medium text-ink">{opt.label}</span>
            </label>
          );
        })}
      </div>
      {/* Issue #25 — explain what each option actually delivers. The digest
          is the 12i daily email: top stories ranked by the same feed score,
          grouped by sector, with a one-line "why it matters" per story. */}
      <div className="mt-4 space-y-2 rounded-md border border-line bg-bg/50 p-4 text-sm text-ink-muted">
        <p>
          <span className="font-medium text-ink">Yes, daily</span> — each
          morning we email the day&apos;s top stories across your sectors,
          ranked the same way as your feed, with a one-line take on why each
          one matters.
        </p>
        <p>
          <span className="font-medium text-ink">No, thanks</span> — skip the
          email and read everything in the feed instead.
        </p>
        <p>You can change this anytime in Settings.</p>
      </div>
      {/* Phase 12w — optional self-reported acquisition source. Complements the
          automatic UTM/referrer attribution captured at signup. Never gates
          Finish. */}
      <fieldset className="mt-6 space-y-2">
        <legend className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          How did you hear about us?{" "}
          <span className="font-normal normal-case text-ink-muted">
            — optional
          </span>
        </legend>
        <select
          className="w-full rounded-md border bg-background p-3 font-medium"
          value={store.howDidYouHear}
          onChange={(e) => store.setHowDidYouHear(e.target.value)}
        >
          <option value="">Prefer not to say</option>
          {HOW_DID_YOU_HEAR.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </fieldset>
      {store.timezone && (
        <p className="mt-4 text-center text-xs text-ink-muted">
          Detected timezone: {store.timezone}
        </p>
      )}
    </OnboardingShell>
  );
}
