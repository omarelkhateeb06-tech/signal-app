"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateTeam } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { extractApiError } from "@/lib/api";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Max 60 characters"),
  slug: z
    .string()
    .trim()
    .min(3, "Slug must be at least 3 characters")
    .max(100, "Max 100 characters")
    .regex(slugRegex, "Lowercase letters, numbers, and hyphens only"),
  description: z.string().trim().max(500, "Max 500 characters").optional(),
});

type CreateTeamFormValues = z.infer<typeof createTeamSchema>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export default function NewTeamPage(): JSX.Element {
  const router = useRouter();
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);
  const createTeam = useCreateTeam();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateTeamFormValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const nameValue = watch("name");

  useEffect(() => {
    if (slugEdited) return;
    setValue("slug", slugify(nameValue ?? ""), { shouldValidate: false });
  }, [nameValue, slugEdited, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const team = await createTeam.mutateAsync({
        name: values.name,
        slug: values.slug,
        description: values.description?.trim() ? values.description.trim() : null,
      });
      setActiveTeam(team.id);
      router.push(`/teams/${team.id}`);
    } catch (error) {
      setSubmitError(extractApiError(error, "Failed to create team."));
    }
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create a team</h1>
        <p className="mt-1 text-sm text-slate-500">
          Teams share a feed, comments, and dashboards. You&apos;ll be the admin.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="team-name" className="block text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            id="team-name"
            type="text"
            autoFocus
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            {...register("name")}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="team-slug" className="block text-sm font-medium text-slate-700">
            Slug
          </label>
          <input
            id="team-slug"
            type="text"
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            {...register("slug", {
              onChange: () => setSlugEdited(true),
            })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Used in links. Lowercase letters, numbers, and hyphens only.
          </p>
          {errors.slug && (
            <p className="mt-1 text-xs text-rose-600">{errors.slug.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="team-description" className="block text-sm font-medium text-slate-700">
            Description <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="team-description"
            rows={3}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            {...register("description")}
          />
          {errors.description && (
            <p className="mt-1 text-xs text-rose-600">{errors.description.message}</p>
          )}
        </div>

        {submitError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Link
            href="/teams"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating…" : "Create team"}
          </button>
        </div>
      </form>
    </div>
  );
}
