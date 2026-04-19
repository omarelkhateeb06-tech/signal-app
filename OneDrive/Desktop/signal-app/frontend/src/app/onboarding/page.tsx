"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { extractApiError, updateMyProfileRequest } from "@/lib/api";
import { GOALS, ROLES, SECTORS } from "@/lib/onboarding";

const TOTAL_STEPS = 3;

export default function OnboardingPage(): JSX.Element | null {
  const { ready } = useRequireAuth();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sectors, setSectors] = useState<string[]>([]);
  const [role, setRole] = useState<string>("");
  const [goals, setGoals] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = useMemo(() => {
    if (step === 1) return sectors.length >= 1;
    if (step === 2) return role.length > 0;
    return goals.length >= 1;
  }, [step, sectors, role, goals]);

  const toggleSector = (value: string): void => {
    setSectors((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  const toggleGoal = (value: string): void => {
    setGoals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  const handleBack = (): void => {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleNext = (): void => {
    setError(null);
    if (!canContinue) return;
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (!canContinue) return;
    setSubmitting(true);
    try {
      await updateMyProfileRequest({
        sectors,
        role,
        goals,
        email_frequency: "weekly",
      });
      router.push("/feed");
    } catch (err) {
      setError(extractApiError(err, "Could not save your preferences"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Welcome to SIGNAL</h1>
          <div
            className="mx-auto h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step}
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </header>

        <section className="rounded-lg border bg-card p-6 shadow-sm">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What sectors interest you?</h2>
                <p className="text-sm text-muted-foreground">
                  Pick one or more. You can change this later in settings.
                </p>
              </div>
              <div className="space-y-3">
                {SECTORS.map((sector) => {
                  const checked = sectors.includes(sector.value);
                  return (
                    <label
                      key={sector.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                        checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={checked}
                        onChange={() => toggleSector(sector.value)}
                      />
                      <div>
                        <p className="font-medium">{sector.label}</p>
                        <p className="text-sm text-muted-foreground">{sector.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What&apos;s your role?</h2>
                <p className="text-sm text-muted-foreground">
                  We tailor the &ldquo;why it matters to you&rdquo; insight to your role.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLES.map((option) => {
                  const checked = role === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                        checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => setRole(option.value)}
                      />
                      <span className="font-medium">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What do you want to achieve?</h2>
                <p className="text-sm text-muted-foreground">
                  Select any that apply.
                </p>
              </div>
              <div className="space-y-2">
                {GOALS.map((goal) => {
                  const checked = goals.includes(goal.value);
                  return (
                    <label
                      key={goal.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                        checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggleGoal(goal.value)}
                      />
                      <span className="font-medium">{goal.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 1 || submitting}
            className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            Back
          </button>
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canContinue}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canContinue || submitting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Finish"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
