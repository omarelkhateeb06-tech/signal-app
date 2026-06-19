"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createBelief,
  deleteBelief,
  getBeliefChallenges,
  getBeliefEvolution,
  listBeliefs,
  respondToBeliefChallenge,
  runBeliefChallenges,
  updateBelief,
  type Belief,
  type BeliefChallenge,
  type BeliefEvolution,
  type ChallengeResponse,
  type ChallengesResponse,
} from "@/lib/api";

// Input shapes are derived from the api.ts wrappers so the position fields
// (conviction/horizon/whatWouldBreakIt) stay in sync without restating them.
type CreateBeliefInput = Parameters<typeof createBelief>[0];
type UpdateBeliefInput = Parameters<typeof updateBelief>[1];

// Belief maintenance — the reader's working assumptions + the weekly
// "Reconsider" ritual. The challenges query is a passive read of what's
// already been matched this week; `run` triggers the (Haiku) matcher and
// writes the result straight into the challenges cache.

export function useBeliefs(): UseQueryResult<Belief[], Error> {
  return useQuery({ queryKey: ["beliefs"], queryFn: listBeliefs });
}

export function useBeliefChallenges(): UseQueryResult<ChallengesResponse, Error> {
  return useQuery({
    queryKey: ["belief-challenges"],
    queryFn: getBeliefChallenges,
    staleTime: 5 * 60 * 1000,
  });
}

// The per-belief evolution timeline — every development that's moved it, with
// the reader's response + note. Enabled on demand (when a belief is expanded).
export function useBeliefEvolution(
  beliefId: string | null,
): UseQueryResult<BeliefEvolution, Error> {
  return useQuery({
    queryKey: ["belief-evolution", beliefId],
    queryFn: () => getBeliefEvolution(beliefId as string),
    enabled: beliefId != null,
    staleTime: 60 * 1000,
  });
}

export interface BeliefMutations {
  create: UseMutationResult<Belief, Error, CreateBeliefInput>;
  update: UseMutationResult<Belief, Error, { id: string; input: UpdateBeliefInput }>;
  remove: UseMutationResult<void, Error, string>;
  // `force` (true on "Re-check") bypasses the per-week cost guard.
  run: UseMutationResult<ChallengesResponse, Error, boolean | undefined>;
  respond: UseMutationResult<
    BeliefChallenge,
    Error,
    { id: string; response: ChallengeResponse; note?: string | null }
  >;
}

export function useBeliefMutations(): BeliefMutations {
  const qc = useQueryClient();
  const invalidateBeliefs = (): void => {
    void qc.invalidateQueries({ queryKey: ["beliefs"] });
  };

  const create = useMutation({
    mutationFn: createBelief,
    onSuccess: invalidateBeliefs,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBeliefInput }) =>
      updateBelief(id, input),
    onSuccess: invalidateBeliefs,
  });

  const remove = useMutation({
    mutationFn: deleteBelief,
    onSuccess: invalidateBeliefs,
  });

  const run = useMutation({
    mutationFn: (force?: boolean) => runBeliefChallenges(force ?? false),
    onSuccess: (data) => {
      qc.setQueryData(["belief-challenges"], data);
    },
  });

  const respond = useMutation({
    mutationFn: ({
      id,
      response,
      note,
    }: {
      id: string;
      response: ChallengeResponse;
      note?: string | null;
    }) => respondToBeliefChallenge(id, response, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["belief-challenges"] });
      void qc.invalidateQueries({ queryKey: ["beliefs"] });
    },
  });

  return { create, update, remove, run, respond };
}
