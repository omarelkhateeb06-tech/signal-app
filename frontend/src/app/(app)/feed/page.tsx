"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { SwissCommandFeed } from "@/components/redesign/swiss/SwissCommandFeed";
// SwissCommandFeed is the production feed (Editorial Redesign v2). The earlier
// parallel designs (MagazineFeed / SwissFeed / TerminalFeed + the /feed-swiss,
// /feed-b routes) were retired June 2026 — see git history if ever needed.

export default function FeedPage(): JSX.Element {
  const router = useRouter();
  const activeTeamId = useTeamsStore((s) => s.activeTeamId);
  const hasHydrated = useTeamsStore((s) => s.hasHydrated);
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);
  const { data: teams } = useTeams({ enabled: hasHydrated && Boolean(activeTeamId) });

  // When a team is active, the feed route forwards to that team's page.
  // Unchanged from the prior feed composition.
  useEffect(() => {
    if (!hasHydrated || !activeTeamId) return;
    if (teams === undefined) return;
    const match = teams.find((t) => t.id === activeTeamId);
    if (!match) {
      setActiveTeam(null);
      return;
    }
    router.replace(`/teams/${activeTeamId}`);
  }, [hasHydrated, activeTeamId, teams, router, setActiveTeam]);

  return <SwissCommandFeed />;
}
