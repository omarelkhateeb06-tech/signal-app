"use client";

import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { useTeams } from "@/hooks/useTeams";
import { extractApiError } from "@/lib/api";

function roleClass(role: string | undefined): string {
  if (role === "admin") return "bg-blue-100 text-blue-700";
  if (role === "viewer") return "bg-slate-100 text-slate-600";
  return "bg-emerald-100 text-emerald-700";
}

export default function TeamsListPage(): JSX.Element {
  const { data: teams, isLoading, error } = useTeams();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Teams</h1>
          <p className="mt-1 text-sm text-slate-500">
            Teams you belong to. Switch contexts or create a new one.
          </p>
        </div>
        <Link
          href="/teams/new"
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Create team
        </Link>
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading teams…</div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(error, "Failed to load teams.")}
        </div>
      )}

      {!isLoading && !error && teams && teams.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-slate-400" aria-hidden />
          <p className="text-sm text-slate-600">
            You&apos;re not on any teams yet. Create one to get started.
          </p>
          <Link
            href="/teams/new"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create team
          </Link>
        </div>
      )}

      {teams && teams.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <li
              key={team.id}
              className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="truncate font-semibold text-slate-900">{team.name}</h2>
                {team.role && (
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${roleClass(team.role)}`}>
                    {team.role}
                  </span>
                )}
              </div>
              {team.description && (
                <p className="mb-3 line-clamp-2 text-sm text-slate-600">{team.description}</p>
              )}
              <Link
                href={`/teams/${team.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
              >
                Open team →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
