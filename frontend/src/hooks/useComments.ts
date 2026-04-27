"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createCommentRequest,
  deleteCommentRequest,
  getRepliesRequest,
  getStoryCommentsRequest,
  updateCommentRequest,
  type CreateCommentInput,
} from "@/lib/api";
import type { Comment, CommentList } from "@/types/comment";

export function useComments(storyId: string | null): UseQueryResult<CommentList, Error> {
  return useQuery({
    queryKey: ["comments", storyId],
    queryFn: () => getStoryCommentsRequest(storyId as string, { limit: 50 }),
    enabled: Boolean(storyId),
  });
}

export function useReplies(
  commentId: string | null,
  enabled: boolean,
): UseQueryResult<Comment[], Error> {
  return useQuery({
    queryKey: ["comment-replies", commentId],
    queryFn: () => getRepliesRequest(commentId as string),
    enabled: Boolean(commentId) && enabled,
  });
}

export function useCreateComment(
  storyId: string,
): UseMutationResult<Comment, Error, CreateCommentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      createCommentRequest(storyId, input),
    onSuccess: (comment) => {
      if (comment.parent_comment_id) {
        void queryClient.invalidateQueries({
          queryKey: ["comment-replies", comment.parent_comment_id],
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["comments", storyId] });
    },
  });
}

export function useDeleteComment(
  storyId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCommentRequest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", storyId] });
      void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
    },
  });
}

export function useEditComment(
  storyId: string,
): UseMutationResult<Comment, Error, { id: string; content: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }) => updateCommentRequest(id, content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", storyId] });
      void queryClient.invalidateQueries({ queryKey: ["comment-replies"] });
    },
  });
}
