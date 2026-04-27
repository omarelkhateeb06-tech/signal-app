"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect } from "react";
import { LayoutDashboard, Settings, Users } from "lucide-react";
import { useTeam, useTeamFeed, useTeamMembers } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { TeamStoryCard } from "@/components/teams/TeamStoryCard";
import { extractApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

const PAGE_SIZE = 20;

export default function TeamFeedPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);

  const { data: team, isLoading: teamLoading, error: teamError } = useTeam(teamId);
  const { data: members } = useTeamMembers(teamId);
  const {
    data: feed,
    isLoading: feedLoading,
    error: feedError,
  } = useTeamFeed(teamId, { limit: PAGE_SIZE, offset: 0 });

  useEffect(() => {
    if (teamId) setActiveTeam(teamId);
  }, [teamId, setActiveTeam]);

  if (!teamId) notFound();

  if (teamError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {extractApiError(teamError, "Failed to load team.")}
      </div>
    );
  }

  const isAdmin = team?.role === "admin";
  const memberCount = members?.length ?? 0;

  return (
    <div className="space-y-6">
      <header className="space-y-3 border-b border-slate-200 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">
              {teamLoading ? "…" : team?.name}
            </h1>
            {team?.description && (
              <p className="mt-1 text-sm text-slate-500">{team.description}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {memberCount} {memberCount === 1 ? "member" : "members"}
              {team?.settings?.sectors?.length ? (
                <>
                  {" · "}
                  {team.settings.sectors.join(", ")}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/teams/${teamId}/members`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              Members
            </Link>
            {isAdmin && (
              <Link
                href={`/teams/${teamId}/dashboard`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
                Dashboard
              </Link>
            )}
            <Link
              href={`/teams/${teamId}/settings`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Settings
            </Link>
          </div>
        </div>
      </header>

      {feedLoading && (
        <div
          className="space-y-4"
          aria-label="Loading stories"
          aria-busy="true"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
            >
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          ))}
        </div>
      )}

      {feedError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(feedError, "Failed to load team feed.")}
        </div>
      )}

      {!feedLoading && !feedError && feed && feed.stories.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-600">
            No stories yet.{" "}
            {team?.settings?.sectors?.length === 0 ? (
              isAdmin ? (
                <>
                  Add sectors in{" "}
                  <Link
                    href={`/teams/${teamId}/settings`}
                    className="font-medium text-violet-700 hover:underline"
                  >
                    team settings
                  </Link>
                  {" "}to see stories.
                </>
              ) : (
                "An admin needs to add sectors in team settings."
              )
            ) : (
              "Nothing matches your team's sectors yet."
            )}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {feed?.stories.map((story) => (
          <TeamStoryCard key={story.id} story={story} teamId={teamId} />
        ))}
      </div>

      {feed && feed.stories.length > 0 && (
        <div className="py-4 text-center text-xs text-slate-500">
          Showing {feed.stories.length} of {feed.total}
          {feed.has_more && " · Load more coming soon"}
        </div>
      )}
    </div>
  );
}
