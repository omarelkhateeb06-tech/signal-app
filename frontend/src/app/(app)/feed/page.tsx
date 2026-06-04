"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { SwissCommandFeed } from "@/components/redesign/swiss/SwissCommandFeed";
// The prior #141 image-rich "magazine" feed is preserved at
// @/components/feed/MagazineFeed — render <MagazineFeed /> below instead of
// <SwissCommandFeed /> to switch back. Kept intact, not deleted.

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
