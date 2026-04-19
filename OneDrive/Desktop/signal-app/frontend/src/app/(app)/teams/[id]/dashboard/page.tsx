"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { Bookmark, MessageSquare, Tag, Users } from "lucide-react";
import { useTeam, useTeamDashboard } from "@/hooks/useTeams";
import { extractApiError } from "@/lib/api";

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: JSX.Element;
}

function MetricCard({ label, value, icon }: MetricCardProps): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default function TeamDashboardPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const { data: team, isLoading: teamLoading } = useTeam(teamId);
  const { data, isLoading, error } = useTeamDashboard(teamId);

  if (!teamId) notFound();

  if (!teamLoading && team && team.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Only team admins can view the dashboard.{" "}
        <Link
          href={`/teams/${teamId}`}
          className="font-medium underline hover:text-amber-950"
        >
          Back to team
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/teams/${teamId}`}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← Back to team
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Team dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Aggregate activity for {team?.name ?? "this team"}.
        </p>
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading dashboard…</div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(error, "Failed to load dashboard.")}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Members"
              value={data.member_count}
              icon={<Users className="h-3.5 w-3.5" aria-hidden />}
            />
            <MetricCard
              label="Comments"
              value={data.total_comments}
              icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden />}
            />
            <MetricCard
              label="Saves"
              value={data.total_saves}
              icon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
            />
            <MetricCard
              label="Sectors"
              value={data.sectors.length}
              icon={<Tag className="h-3.5 w-3.5" aria-hidden />}
            />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900">
              Stories by sector
            </div>
            {data.stories_by_sector.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-slate-500">
                No sectors configured.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-2 text-left font-medium">Sector</th>
                    <th className="px-6 py-2 text-right font-medium">Stories</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.stories_by_sector.map((row) => (
                    <tr key={row.sector}>
                      <td className="px-6 py-2 capitalize text-slate-900">
                        {row.sector}
                      </td>
                      <td className="px-6 py-2 text-right text-slate-600">
                        {row.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900">
              Top saved stories
            </div>
            {data.top_saved_stories.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-slate-500">
                No saves yet.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.top_saved_stories.map((story) => (
                  <li
                    key={story.id}
                    className="flex items-center justify-between gap-4 px-6 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/stories/${story.id}?team=${teamId}`}
                        className="block truncate font-medium text-slate-900 hover:text-violet-700"
                      >
                        {story.headline}
                      </Link>
                      <div className="text-xs capitalize text-slate-500">
                        {story.sector}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      <Bookmark className="h-3.5 w-3.5" />
                      {story.save_count}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
