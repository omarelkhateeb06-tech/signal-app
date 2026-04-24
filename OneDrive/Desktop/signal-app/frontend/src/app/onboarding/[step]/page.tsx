"use client";

import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useOnboardingStore } from "@/store/onboardingStore";
import {
  DEPTH_PREFERENCES,
  DIGEST_PREFERENCES,
  GOALS,
  ROLES,
  SECTORS,
  SENIORITIES,
  TOPICS_BY_SECTOR,
  DEFAULT_GOAL,
} from "@/lib/onboarding";
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
          return (
            <label
              key={s.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={checked}
                onChange={() => toggle(s.value)}
              />
              <div>
                <p className="font-medium">{s.label}</p>
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </div>
            </label>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 2: role ----------

function Screen2(): JSX.Element {
  const { role, setRole } = useOnboardingStore();
  useScreenViewEvent(2);
  const nav = useOnboardingNav(2);

  return (
    <OnboardingShell
      step={2}
      title="What's your role?"
      description="We tailor commentary framing to your role."
      canContinue={role !== null && role.length > 0}
      onContinue={() => nav.goNext(3)}
      onBack={nav.goBack}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ROLES.map((r) => {
          const checked = role === r.value;
          return (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
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
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
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

// ---------- Screen 4: depth preference ----------

function Screen4(): JSX.Element {
  const { depthPreference, setDepthPreference } = useOnboardingStore();
  useScreenViewEvent(4);
  const nav = useOnboardingNav(4);

  return (
    <OnboardingShell
      step={4}
      title="How deep do you want to go?"
      description="The free tier defaults to Standard. You can change this any time."
      canContinue={true}
      onContinue={() => nav.goNext(5)}
      onBack={nav.goBack}
    >
      <div className="space-y-3">
        {DEPTH_PREFERENCES.map((d) => {
          const checked = depthPreference === d.value;
          return (
            <label
              key={d.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <input
                type="radio"
                name="depth"
                value={d.value}
                className="mt-1 h-4 w-4"
                checked={checked}
                onChange={() => setDepthPreference(d.value as DepthPreference)}
              />
              <div>
                <p className="font-medium">{d.label}</p>
                {d.description && (
                  <p className="text-sm text-muted-foreground">{d.description}</p>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </OnboardingShell>
  );
}

// ---------- Screen 5: topics (skippable) ----------

function Screen5(): JSX.Element {
  const { sectors, topics, setTopics } = useOnboardingStore();
  useScreenViewEvent(5);
  const nav = useOnboardingNav(5);

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
    nav.skip(6);
  };

  return (
    <OnboardingShell
      step={5}
      title="Any topics you especially care about?"
      description="Pick any — or skip and we'll show you everything in your sectors."
      canContinue={true}
      onContinue={() => nav.goNext(6)}
      onSkip={handleSkip}
      onBack={nav.goBack}
    >
      <div className="space-y-6">
        {sectors.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Pick a sector on step 1 first.
          </p>
        )}
        {sectors.map((sector) => {
          const sectorTopics = TOPICS_BY_SECTOR[sector] ?? [];
          const sectorLabel = SECTORS.find((s) => s.value === sector)?.label ?? sector;
          return (
            <div key={sector} className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {sectorLabel}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sectorTopics.map((t) => {
                  const checked = isSelected(sector, t.value);
                  return (
                    <label
                      key={`${sector}:${t.value}`}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                        checked ? "border-primary bg-accent" : "hover:bg-accent/50"
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

// ---------- Screen 6: goals (skippable) ----------

function Screen6(): JSX.Element {
  const { goals, setGoals } = useOnboardingStore();
  useScreenViewEvent(6);
  const nav = useOnboardingNav(6);

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
    nav.skip(7);
  };

  return (
    <OnboardingShell
      step={6}
      title="What do you want to get out of SIGNAL?"
      description="Select any that apply — or skip to use the default."
      canContinue={goals.length >= 1}
      onContinue={() => nav.goNext(7)}
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
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
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

    try {
      await complete.mutateAsync({
        sectors: store.sectors,
        role: store.role ?? "",
        seniority: store.seniority ?? "",
        depth_preference: store.depthPreference,
        topics: resolvedTopics,
        goals: resolvedGoals,
        digest_preference: (store.digestPreference ?? "none") as DigestPreference,
        timezone: store.timezone ?? "UTC",
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
      title="How often do you want a digest?"
      canContinue={canContinue}
      isSubmitting={complete.isPending}
      continueLabel="Finish"
      onContinue={submit}
      onBack={nav.goBack}
      error={error}
    >
      <div className="space-y-3">
        {DIGEST_PREFERENCES.map((d) => {
          const checked = store.digestPreference === d.value;
          return (
            <label
              key={d.value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                checked ? "border-primary bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <input
                type="radio"
                name="digest"
                value={d.value}
                className="h-4 w-4"
                checked={checked}
                onChange={() =>
                  store.setDigestPreference(d.value as DigestPreference)
                }
              />
              <span className="font-medium">{d.label}</span>
            </label>
          );
        })}
        {store.timezone && (
          <p className="text-xs text-muted-foreground">
            Detected timezone: {store.timezone}
          </p>
        )}
      </div>
    </OnboardingShell>
  );
}
