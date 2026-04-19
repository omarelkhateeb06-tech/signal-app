import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/types/team";

vi.mock("@/lib/api", () => ({
  listTeamsRequest: vi.fn(),
  getTeamRequest: vi.fn(),
  createTeamRequest: vi.fn(),
  updateTeamRequest: vi.fn(),
  deleteTeamRequest: vi.fn(),
  listTeamMembersRequest: vi.fn(),
  removeTeamMemberRequest: vi.fn(),
  inviteTeamMemberRequest: vi.fn(),
  getTeamFeedRequest: vi.fn(),
  updateTeamSettingsRequest: vi.fn(),
  getTeamDashboardRequest: vi.fn(),
  inviteAcceptRequest: vi.fn(),
  inviteMetadataRequest: vi.fn(),
  listTeamInvitesRequest: vi.fn(),
  resendTeamInviteRequest: vi.fn(),
  revokeTeamInviteRequest: vi.fn(),
}));

import * as api from "@/lib/api";
import { useAcceptInvite, useCreateTeam, useTeams } from "./useTeams";

function wrapper(): { client: QueryClient; Wrapper: (props: { children: ReactNode }) => JSX.Element } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

const sampleTeam: Team = {
  id: "t1",
  name: "Team One",
  slug: "team-one",
  description: null,
  created_by: "u1",
  settings: { sectors: [] },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  role: "admin",
};

describe("useTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the team list", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue([sampleTeam]);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useTeams(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([sampleTeam]);
    expect(api.listTeamsRequest).toHaveBeenCalledTimes(1);
  });

  it("respects enabled=false", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue([]);
    const { Wrapper } = wrapper();

    renderHook(() => useTeams({ enabled: false }), { wrapper: Wrapper });

    // Give react-query a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listTeamsRequest).not.toHaveBeenCalled();
  });
});

describe("useCreateTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates the teams list on success", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue([]);
    vi.mocked(api.createTeamRequest).mockResolvedValue(sampleTeam);
    const { client, Wrapper } = wrapper();

    // Prime the teams query so invalidation has something to refetch
    const list = renderHook(() => useTeams(), { wrapper: Wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(api.listTeamsRequest).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useCreateTeam(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "X", slug: "x" });
    });

    await waitFor(() => {
      expect(api.listTeamsRequest).toHaveBeenCalledTimes(2);
    });

    const state = client.getQueryState(["teams"]);
    expect(state?.status).toBe("success");
  });
});

describe("useAcceptInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates team, members, invites, and dashboard queries for the accepted team", async () => {
    const teamId = "t1";
    vi.mocked(api.inviteAcceptRequest).mockResolvedValue({
      token: "auth-token",
      user: { id: "u2", email: "b@example.com", name: "B" },
      team: { id: teamId, name: "Team One", slug: "team-one" },
      role: "member",
      created: true,
    });
    const { client, Wrapper } = wrapper();

    // Seed the caches we expect to be invalidated.
    client.setQueryData(["teams"], []);
    client.setQueryData(["teams", teamId], sampleTeam);
    client.setQueryData(["teams", teamId, "members"], []);
    client.setQueryData(["teams", teamId, "invites"], []);
    client.setQueryData(["teams", teamId, "dashboard"], {});

    const { result } = renderHook(() => useAcceptInvite(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ token: "invite-token" });
    });

    await waitFor(() => {
      expect(
        client.getQueryState(["teams", teamId, "members"])?.isInvalidated,
      ).toBe(true);
    });

    expect(client.getQueryState(["teams"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["teams", teamId])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["teams", teamId, "invites"])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["teams", teamId, "dashboard"])?.isInvalidated,
    ).toBe(true);
  });
});
