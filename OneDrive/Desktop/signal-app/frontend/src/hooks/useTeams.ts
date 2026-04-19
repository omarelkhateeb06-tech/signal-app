"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createTeamRequest,
  deleteTeamRequest,
  getTeamDashboardRequest,
  getTeamFeedRequest,
  getTeamRequest,
  inviteTeamMemberRequest,
  listTeamMembersRequest,
  listTeamsRequest,
  removeTeamMemberRequest,
  updateTeamRequest,
  updateTeamSettingsRequest,
  type CreateTeamInput,
  type InviteMemberInput,
  type TeamFeedParams,
  type UpdateTeamInput,
} from "@/lib/api";
import { useTeamsStore } from "@/store/teamsStore";
import type {
  Team,
  TeamDashboard,
  TeamFeedResponse,
  TeamInvite,
  TeamMember,
} from "@/types/team";

const teamsKey = ["teams"] as const;
const teamKey = (id: string): readonly [string, string] => ["teams", id];
const membersKey = (id: string): readonly [string, string, string] => [
  "teams",
  id,
  "members",
];
const feedKey = (
  id: string,
  params: TeamFeedParams,
): readonly [string, string, string, TeamFeedParams] => [
  "teams",
  id,
  "feed",
  params,
];
const dashboardKey = (id: string): readonly [string, string, string] => [
  "teams",
  id,
  "dashboard",
];

export function useTeams(
  options: { enabled?: boolean } = {},
): UseQueryResult<Team[], Error> {
  return useQuery({
    queryKey: teamsKey,
    queryFn: listTeamsRequest,
    enabled: options.enabled ?? true,
  });
}

export function useTeam(
  id: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<Team, Error> {
  return useQuery({
    queryKey: teamKey(id ?? ""),
    queryFn: () => getTeamRequest(id as string),
    enabled: Boolean(id) && (options.enabled ?? true),
  });
}

export function useTeamMembers(
  id: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<TeamMember[], Error> {
  return useQuery({
    queryKey: membersKey(id ?? ""),
    queryFn: () => listTeamMembersRequest(id as string),
    enabled: Boolean(id) && (options.enabled ?? true),
  });
}

export function useTeamFeed(
  id: string | null | undefined,
  params: TeamFeedParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<TeamFeedResponse, Error> {
  return useQuery({
    queryKey: feedKey(id ?? "", params),
    queryFn: () => getTeamFeedRequest(id as string, params),
    enabled: Boolean(id) && (options.enabled ?? true),
  });
}

export function useTeamDashboard(
  id: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<TeamDashboard, Error> {
  return useQuery({
    queryKey: dashboardKey(id ?? ""),
    queryFn: () => getTeamDashboardRequest(id as string),
    enabled: Boolean(id) && (options.enabled ?? true),
  });
}

export function useCreateTeam(): UseMutationResult<Team, Error, CreateTeamInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => createTeamRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKey });
    },
  });
}

export function useUpdateTeam(
  id: string,
): UseMutationResult<Team, Error, UpdateTeamInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTeamInput) => updateTeamRequest(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKey(id) });
      void qc.invalidateQueries({ queryKey: teamsKey });
    },
  });
}

export function useUpdateTeamSettings(
  id: string,
): UseMutationResult<Team, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectors: string[]) => updateTeamSettingsRequest(id, sectors),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKey(id) });
      void qc.invalidateQueries({ queryKey: ["teams", id, "feed"] });
      void qc.invalidateQueries({ queryKey: dashboardKey(id) });
    },
  });
}

export function useDeleteTeam(id: string): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  const clearActiveIfMatches = useTeamsStore((s) => s.setActiveTeam);
  const activeTeamId = useTeamsStore((s) => s.activeTeamId);
  return useMutation({
    mutationFn: () => deleteTeamRequest(id),
    onSuccess: () => {
      if (activeTeamId === id) clearActiveIfMatches(null);
      void qc.invalidateQueries({ queryKey: teamsKey });
      qc.removeQueries({ queryKey: teamKey(id) });
    },
  });
}

export function useInviteTeamMember(
  id: string,
): UseMutationResult<TeamInvite, Error, InviteMemberInput> {
  return useMutation({
    mutationFn: (input: InviteMemberInput) =>
      inviteTeamMemberRequest(id, input),
  });
}

export function useRemoveTeamMember(
  id: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeTeamMemberRequest(id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKey(id) });
      void qc.invalidateQueries({ queryKey: dashboardKey(id) });
    },
  });
}
