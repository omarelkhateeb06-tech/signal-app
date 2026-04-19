"use client";

import { useRouter, useParams, notFound } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import {
  useDeleteTeam,
  useTeam,
  useUpdateTeam,
  useUpdateTeamSettings,
} from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { SECTORS } from "@/lib/onboarding";
import { extractApiError } from "@/lib/api";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Max 60 characters"),
  description: z.string().trim().max(500, "Max 500 characters").optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function TeamSettingsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;
  const router = useRouter();
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);
  const activeTeamId = useTeamsStore((s) => s.activeTeamId);

  const { data: team, isLoading, error } = useTeam(teamId);
  const updateTeam = useUpdateTeam(teamId ?? "");
  const updateSettings = useUpdateTeamSettings(teamId ?? "");
  const deleteTeam = useDeleteTeam(teamId ?? "");

  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [sectorsError, setSectorsError] = useState<string | null>(null);
  const [sectorsSaved, setSectorsSaved] = useState(false);
  const [sectors, setSectors] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (!team) return;
    reset({
      name: team.name,
      description: team.description ?? "",
    });
    setSectors(team.settings?.sectors ?? []);
  }, [team, reset]);

  if (!teamId) notFound();

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {extractApiError(error, "Failed to load team.")}
      </div>
    );
  }

  const isAdmin = team?.role === "admin";

  const onSubmitProfile = handleSubmit(async (values) => {
    setProfileError(null);
    setProfileSaved(false);
    try {
      await updateTeam.mutateAsync({
        name: values.name,
        description: values.description?.trim() ? values.description.trim() : null,
      });
      setProfileSaved(true);
    } catch (err) {
      setProfileError(extractApiError(err, "Failed to update team."));
    }
  });

  const toggleSector = (value: string): void => {
    setSectors((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  };

  const saveSectors = async (): Promise<void> => {
    setSectorsError(null);
    setSectorsSaved(false);
    try {
      await updateSettings.mutateAsync(sectors);
      setSectorsSaved(true);
    } catch (err) {
      setSectorsError(extractApiError(err, "Failed to update sectors."));
    }
  };

  const onDelete = async (): Promise<void> => {
    setDeleteError(null);
    const confirmed = window.confirm(
      `Delete team "${team?.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteTeam.mutateAsync();
      if (activeTeamId === teamId) setActiveTeam(null);
      router.push("/teams");
    } catch (err) {
      setDeleteError(extractApiError(err, "Failed to delete team."));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <Link
          href={`/teams/${teamId}`}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← Back to team
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Team settings
        </h1>
        {!isAdmin && (
          <p className="mt-1 text-xs text-slate-500">
            Read-only. Only admins can change team settings.
          </p>
        )}
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Profile</h2>
        <form onSubmit={onSubmitProfile} className="space-y-4" noValidate>
          <div>
            <label htmlFor="team-name" className="block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="team-name"
              type="text"
              disabled={!isAdmin}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
              {...register("name")}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="team-description"
              className="block text-sm font-medium text-slate-700"
            >
              Description
            </label>
            <textarea
              id="team-description"
              rows={3}
              disabled={!isAdmin}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm disabled:bg-slate-50 disabled:text-slate-500"
              {...register("description")}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-rose-600">{errors.description.message}</p>
            )}
          </div>
          {profileError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {profileError}
            </div>
          )}
          {profileSaved && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Saved.
            </div>
          )}
          {isAdmin && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !isDirty}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Saving…" : "Save profile"}
              </button>
            </div>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Sectors</h2>
        <p className="mb-4 text-xs text-slate-500">
          Stories in these sectors appear in the team feed.
        </p>
        <div className="space-y-2">
          {SECTORS.map((s) => {
            const checked = sectors.includes(s.value);
            return (
              <label
                key={s.value}
                className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                  checked ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-white"
                } ${isAdmin ? "cursor-pointer hover:bg-slate-50" : "cursor-default"}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  disabled={!isAdmin}
                  onChange={() => toggleSector(s.value)}
                />
                <div>
                  <div className="font-medium text-slate-900">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.description}</div>
                </div>
              </label>
            );
          })}
        </div>
        {sectorsError && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {sectorsError}
          </div>
        )}
        {sectorsSaved && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Sectors updated.
          </div>
        )}
        {isAdmin && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={saveSectors}
              disabled={updateSettings.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateSettings.isPending ? "Saving…" : "Save sectors"}
            </button>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-rose-900">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Danger zone
          </div>
          <p className="mb-4 text-sm text-rose-800">
            Deleting the team removes all members, comments, and team saves. This cannot
            be undone.
          </p>
          {deleteError && (
            <div className="mb-3 rounded-md border border-rose-300 bg-white p-3 text-sm text-rose-800">
              {deleteError}
            </div>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteTeam.isPending}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteTeam.isPending ? "Deleting…" : "Delete team"}
          </button>
        </section>
      )}
    </div>
  );
}
