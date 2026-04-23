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
} from "@/lib/onboarding";
import { Toast, type ToastTone } from "@/components/ui/Toast";
import type { DepthPreference, EmailFrequency, UserProfile } from "@/types/auth";

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
        applyProfile(data.profile);
      } catch (err) {
        if (!cancelled) setLoadError(extractApiError(err, "Could not load settings"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const applyProfile = (profile: UserProfile | null): void => {
      setSectors(profile?.sectors ?? []);
      setRole(profile?.role ?? "");
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
      await updateProfile.mutateAsync({
        sectors,
        role,
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
    setSectors((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };
  const toggleGoal = (value: string): void => {
    setGoals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
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
          <h2 className="text-lg font-semibold">Profile</h2>
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
          <h2 className="text-lg font-semibold">Interests</h2>
          <p className="text-xs text-muted-foreground">
            What we use to personalize your feed and insights.
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
