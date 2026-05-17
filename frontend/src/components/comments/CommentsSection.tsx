"use client";

import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useEditComment,
} from "@/hooks/useComments";
import { extractApiError } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { CommentForm } from "./CommentForm";
import { CommentItem } from "./CommentItem";

interface CommentsSectionProps {
  storyId: string;
}

export function CommentsSection({ storyId }: CommentsSectionProps): JSX.Element {
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const query = useComments(storyId);
  const create = useCreateComment(storyId);
  const remove = useDeleteComment(storyId);
  const edit = useEditComment(storyId);

  const comments = query.data?.comments ?? [];
  const total = query.data?.total ?? 0;

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">
          Comments {total > 0 && <span className="text-ink-muted/70">({total})</span>}
        </h2>
      </div>

      {isAuthed && (
        <CommentForm
          isSubmitting={create.isPending}
          onSubmit={async (content) => {
            await create.mutateAsync({ content });
          }}
        />
      )}

      {create.error && (
        <p className="text-sm text-err">
          {extractApiError(create.error, "Failed to post comment.")}
        </p>
      )}

      {query.isLoading && (
        <p className="text-sm text-ink-muted">Loading comments…</p>
      )}

      {query.error && (
        <p className="text-sm text-err">
          {extractApiError(query.error, "Failed to load comments.")}
        </p>
      )}

      {!query.isLoading && comments.length === 0 && (
        <p className="rounded-md border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
          Be the first to comment.
        </p>
      )}

      <div className="space-y-6">
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            storyId={storyId}
            isSubmittingReply={create.isPending}
            isSubmittingEdit={edit.isPending}
            onReply={async ({ content, parentId }) => {
              await create.mutateAsync({
                content,
                parent_comment_id: parentId,
              });
            }}
            onDelete={async (id) => {
              await remove.mutateAsync(id);
            }}
            onEdit={async ({ id, content }) => {
              await edit.mutateAsync({ id, content });
            }}
          />
        ))}
      </div>
    </section>
  );
}
