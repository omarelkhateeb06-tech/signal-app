"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateMyProfile } from "@/hooks/useProfile";
import {
  extractApiError,
  getMyProfileRequest,
  updateEmailPreferencesRequest,
  updateMeRequest,
} from "@/lib/api";
import {
  DEFAULT_DEPTH_PREFERENCE,
  DEPTH_PREFERENCES,
  EMAIL_FREQUENCIES,
  GOALS,
  ROLES,
  SECTORS,
  SENIORITIES,
  TOPICS_BY_SECTOR,
} from "@/lib/onboarding";
import { getDomainOptionsForSectors } from "@/lib/onboarding/domainOptions";
import { Toast, type ToastTone } from "@/components/ui/Toast";
import type {
  DepthPreference,
  EmailFrequency,
  TopicInterest,
  UserProfile,
} from "@/types/auth";

const profileFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  profile_picture_url: z
    .string()
    .trim()
    .max(2048)
    .url("Must be a valid URL")
    .or(z.literal("")),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

interface ToastState {
  message: string;
  tone: ToastTone;
  id: number;
}

export default function SettingsPage(): JSX.Element {
  const { user, setUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [sectors, setSectors] = useState<string[]>([]);
  const [role, setRole] = useState<string>("");
  // Phase 12c — domain, seniority, and topics join the editable set so
  // the full commentary-input surface can be tweaked without going
  // back through onboarding. Empty string means "not set yet" — stored
  // as null on the profile, distinguished here so the <select> renders
  // the placeholder option rather than accidentally picking the first
  // real value.
  const [domain, setDomain] = useState<string>("");
  const [seniority, setSeniority] = useState<string>("");
  const [topics, setTopics] = useState<TopicInterest[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [depthPreference, setDepthPreference] = useState<DepthPreference>(
    DEFAULT_DEPTH_PREFERENCE,
  );
  const [emailFrequency, setEmailFrequency] = useState<EmailFrequency>("weekly");
  const [emailUnsubscribed, setEmailUnsubscribed] = useState(false);

  const [savingEmail, setSavingEmail] = useState(false);

  const updateProfile = useUpdateMyProfile();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    defaultValues: { name: "", profile_picture_url: "" },
  });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await getMyProfileRequest();
        if (cancelled) return;
        reset({
          name: data.user.name ?? "",
          profile_picture_url: data.user.profilePictureUrl ?? "",
        });
        setUser(data.user);
        applyProfile(data.profile, data.topic_interests);
      } catch (err) {
        if (!cancelled) setLoadError(extractApiError(err, "Could not load settings"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const applyProfile = (
      profile: UserProfile | null,
      topicInterests: TopicInterest[],
    ): void => {
      setSectors(profile?.sectors ?? []);
      setRole(profile?.role ?? "");
      setDomain(profile?.domain ?? "");
      setSeniority(profile?.seniority ?? "");
      setTopics(topicInterests ?? []);
      setGoals(profile?.goals ?? []);
      setDepthPreference(profile?.depthPreference ?? DEFAULT_DEPTH_PREFERENCE);
      setEmailFrequency(profile?.emailFrequency ?? "weekly");
      setEmailUnsubscribed(profile?.emailUnsubscribed ?? false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [reset, setUser]);

  const showToast = (message: string, tone: ToastTone = "success"): void => {
    setToast({ message, tone, id: Date.now() });
  };

  const onSubmitProfile = handleSubmit(async (values) => {
    const parsed = profileFormSchema.safeParse(values);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message ?? "Invalid input", "error");
      return;
    }
    try {
      const updated = await updateMeRequest({
        name: parsed.data.name,
        profile_picture_url: parsed.data.profile_picture_url === ""
          ? null
          : parsed.data.profile_picture_url,
      });
      setUser(updated);
      showToast("Profile updated");
    } catch (err) {
      showToast(extractApiError(err, "Could not save profile"), "error");
    }
  });

  const saveInterests = async (): Promise<void> => {
    if (sectors.length === 0) {
      showToast("Pick at least one sector", "error");
      return;
    }
    if (!role) {
      showToast("Pick a role", "error");
      return;
    }
    if (goals.length === 0) {
      showToast("Pick at least one goal", "error");
      return;
    }
    try {
      // mutateAsync + the onSuccess invalidate in useUpdateMyProfile
      // means the TanStack profile cache is refreshed before we paint
      // the toast. Without that, the (app) layout's useRequireOnboarded
      // reads the stale cache on next render and can bounce a just-
      // saved user back to onboarding. (Issue #5.)
      //
      // Phase 12c — domain/seniority/topic_interests are sent only when
      // the user has a value for them; otherwise the backend keeps its
      // current stored value untouched. topic_interests is sent as [] to
      // mean "I explicitly want no topics" so the wholesale replacement
      // path fires correctly; the "unset" case is represented by not
      // sending the key at all. Here we always send whatever is in
      // state because the Settings UI always renders the topics editor.
      await updateProfile.mutateAsync({
        sectors,
        role,
        domain: domain || undefined,
        seniority: seniority || undefined,
        topic_interests: topics,
        goals,
        depth_preference: depthPreference,
        email_frequency: emailFrequency,
        email_unsubscribed: emailUnsubscribed,
      });
      showToast("Interests updated");
    } catch (err) {
      showToast(extractApiError(err, "Could not save interests"), "error");
    }
  };

  const saveEmailPreferences = async (): Promise<void> => {
    setSavingEmail(true);
    try {
      await updateEmailPreferencesRequest({
        email_frequency: emailFrequency,
        email_unsubscribed: emailUnsubscribed,
      });
      showToast("Email preferences updated");
    } catch (err) {
      showToast(extractApiError(err, "Could not save preferences"), "error");
    } finally {
      setSavingEmail(false);
    }
  };

  const toggleSector = (value: string): void => {
    setSectors((current) => {
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      // When a sector is removed, strip any topic pairs under it so we
      // never submit `{sector: "finance", topic: ...}` while finance is
      // no longer selected — the backend would accept (topics are
      // independent rows) but it would violate the UI invariant that
      // topics mirror selected sectors. Cheap, done in the same render
      // as the sector change.
      setTopics((t) => t.filter((pair) => next.includes(pair.sector)));
      // Domain options are derived from selected sectors; if the stored
      // domain is no longer in the union, fall back to the sentinel.
      // Skip this check when domain is blank or is already the
      // general_not_sure sentinel (always valid).
      if (domain && domain !== "general_not_sure") {
        const valid = getDomainOptionsForSectors(next).some(
          (o) => o.value === domain,
        );
        if (!valid) setDomain("general_not_sure");
      }
      return next;
    });
  };
  const toggleGoal = (value: string): void => {
    setGoals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };
  const toggleTopic = (sector: string, topic: string): void => {
    setTopics((current) => {
      const key = `${sector}:${topic}`;
      const has = current.some((p) => `${p.sector}:${p.topic}` === key);
      return has
        ? current.filter((p) => `${p.sector}:${p.topic}` !== key)
        : [...current, { sector, topic }];
    });
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }
  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile and preferences.</p>
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Commentary depth & topics</h2>
          <p className="text-xs text-muted-foreground">
            How deep the commentary goes, and which topics within each sector.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Commentary depth</p>
          <p className="text-xs text-muted-foreground">
            How deep the commentary goes on each story. Change any time.
          </p>
          <div
            role="radiogroup"
            aria-label="Commentary depth"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {DEPTH_PREFERENCES.map((option) => {
              const checked = depthPreference === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm ${
                    checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="depth_preference"
                      value={option.value}
                      checked={checked}
                      onChange={() =>
                        setDepthPreference(option.value as DepthPreference)
                      }
                      className="h-4 w-4"
                    />
                    <span className="font-medium">{option.label}</span>
                  </span>
                  {option.description && (
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {sectors.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Topics</p>
              <p className="text-xs text-muted-foreground">
                Narrow the commentary within each sector. Leaving all topics
                unchecked for a sector means you want the full sector feed.
              </p>
            </div>
            {sectors.map((sector) => {
              const options = TOPICS_BY_SECTOR[sector] ?? [];
              if (options.length === 0) return null;
              const sectorLabel =
                SECTORS.find((s) => s.value === sector)?.label ?? sector;
              return (
                <div key={sector} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {sectorLabel}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {options.map((option) => {
                      const checked = topics.some(
                        (t) => t.sector === sector && t.topic === option.value,
                      );
                      return (
                        <label
                          key={option.value}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                            checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTopic(sector, option.value)}
                            className="h-4 w-4"
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Sectors & goals</h2>
          <p className="text-xs text-muted-foreground">
            What you&apos;re tracking and what you want to get out of the feed.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Sectors</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SECTORS.map((sector) => {
              const checked = sectors.includes(sector.value);
              return (
                <label
                  key={sector.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                    checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSector(sector.value)}
                    className="h-4 w-4"
                  />
                  {sector.label}
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Goals</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {GOALS.map((goal) => {
              const checked = goals.includes(goal.value);
              return (
                <label
                  key={goal.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                    checked ? "border-primary bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGoal(goal.value)}
                    className="h-4 w-4"
                  />
                  {goal.label}
                </label>
              );
            })}
          </div>
        </div>
      </section>

      {/* The "Save interests" button at the bottom of this section is
          the single commit point for everything in the three sections
          above — depth, topics, sectors, goals, role, domain, seniority
          all flow through one saveInterests mutation. */}
      <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Profile basics</h2>
          <p className="text-xs text-muted-foreground">
            Helps us calibrate commentary to your role and seniority.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select a role…</option>
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="domain" className="text-sm font-medium">
            Field / domain
          </label>
          <p className="text-xs text-muted-foreground">
            The specific area you work in within your sector(s). Feeds the
            commentary prompt so insights speak to your day-to-day.
          </p>
          <select
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select a field…</option>
            {getDomainOptionsForSectors(sectors).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="seniority" className="text-sm font-medium">
            Seniority
          </label>
          <select
            id="seniority"
            value={seniority}
            onChange={(e) => setSeniority(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select your seniority…</option>
            {SENIORITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveInterests}
            disabled={updateProfile.isPending}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {updateProfile.isPending ? "Saving…" : "Save interests"}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Account</h2>
          <p className="text-xs text-muted-foreground">Signed in as {user?.email}</p>
        </div>
        <form onSubmit={onSubmitProfile} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="profile_picture_url" className="text-sm font-medium">
              Profile picture URL
            </label>
            <input
              id="profile_picture_url"
              type="url"
              placeholder="https://…"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              {...register("profile_picture_url")}
            />
            {errors.profile_picture_url && (
              <p className="text-xs text-destructive">{errors.profile_picture_url.message}</p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {isSubmitting ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Email preferences</h2>
          <p className="text-xs text-muted-foreground">
            How often we send your briefing.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="email_frequency" className="text-sm font-medium">
            Frequency
          </label>
          <select
            id="email_frequency"
            value={emailFrequency}
            onChange={(e) => setEmailFrequency(e.target.value as EmailFrequency)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {EMAIL_FREQUENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailUnsubscribed}
            onChange={(e) => setEmailUnsubscribed(e.target.checked)}
            className="h-4 w-4"
          />
          Unsubscribe from all marketing email
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveEmailPreferences}
            disabled={savingEmail}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {savingEmail ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </section>

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
