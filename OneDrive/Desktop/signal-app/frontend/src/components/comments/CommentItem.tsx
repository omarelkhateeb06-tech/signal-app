"use client";

import { useState } from "react";
import clsx from "clsx";
import { useAuthStore } from "@/store/authStore";
import { useReplies } from "@/hooks/useComments";
import { timeAgo } from "@/lib/timeAgo";
import { extractApiError } from "@/lib/api";
import type { Comment } from "@/types/comment";
import { Avatar } from "./Avatar";
import { CommentForm } from "./CommentForm";

interface CommentItemProps {
  comment: Comment;
  storyId: string;
  depth?: number;
  onReply?: (input: { content: string; parentId: string }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onEdit?: (input: { id: string; content: string }) => Promise<void>;
  isSubmittingReply?: boolean;
  isSubmittingEdit?: boolean;
}

export function CommentItem({
  comment,
  storyId: _storyId,
  depth = 0,
  onReply,
  onDelete,
  onEdit,
  isSubmittingReply,
  isSubmittingEdit,
}: CommentItemProps): JSX.Element {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isOwner = currentUserId === comment.author.id && !comment.is_deleted;
  const [replyOpen, setReplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const replies = useReplies(comment.id, showReplies && comment.reply_count > 0);
  const isTopLevel = depth === 0;

  return (
    <article className={clsx("flex gap-3", depth > 0 && "pl-2")}>
      <Avatar
        name={comment.author.name}
        email={comment.author.email}
        url={comment.author.profile_picture_url}
      />
      <div className="flex-1 space-y-2">
        <header className="flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-900">
            {comment.author.name ?? comment.author.email}
          </span>
          <span className="text-slate-500">{timeAgo(comment.created_at)}</span>
          {comment.updated_at !== comment.created_at && !comment.is_deleted && (
            <span className="text-slate-400">(edited)</span>
          )}
        </header>

        {editOpen && !comment.is_deleted ? (
          <CommentForm
            initialValue={comment.content}
            submitLabel="Save"
            autoFocus
            isSubmitting={isSubmittingEdit}
            onCancel={() => setEditOpen(false)}
            onSubmit={async (content) => {
              await onEdit?.({ id: comment.id, content });
              setEditOpen(false);
            }}
          />
        ) : (
          <p
            className={clsx(
              "whitespace-pre-wrap text-sm leading-relaxed",
              comment.is_deleted ? "italic text-slate-400" : "text-slate-800",
            )}
          >
            {comment.content}
          </p>
        )}

        {!editOpen && (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {isTopLevel && onReply && !comment.is_deleted && (
              <button
                type="button"
                onClick={() => setReplyOpen((v) => !v)}
                className="hover:text-violet-700"
              >
                Reply
              </button>
            )}
            {isOwner && onEdit && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="hover:text-violet-700"
              >
                Edit
              </button>
            )}
            {isOwner && onDelete && (
              <button
                type="button"
                onClick={() => {
                  void onDelete(comment.id);
                }}
                className="hover:text-rose-600"
              >
                Delete
              </button>
            )}
          </div>
        )}

        {replyOpen && onReply && (
          <CommentForm
            placeholder="Write a reply…"
            submitLabel="Reply"
            autoFocus
            isSubmitting={isSubmittingReply}
            onCancel={() => setReplyOpen(false)}
            onSubmit={async (content) => {
              await onReply({ content, parentId: comment.id });
              setReplyOpen(false);
              setShowReplies(true);
            }}
          />
        )}

        {isTopLevel && comment.reply_count > 0 && (
          <div className="space-y-3 border-l-2 border-slate-100 pl-4">
            <button
              type="button"
              onClick={() => setShowReplies((v) => !v)}
              className="text-xs font-medium text-violet-700 hover:underline"
            >
              {showReplies
                ? "Hide replies"
                : `Show ${comment.reply_count} ${
                    comment.reply_count === 1 ? "reply" : "replies"
                  }`}
            </button>
            {showReplies && (
              <>
                {replies.isLoading && (
                  <p className="text-xs text-slate-500">Loading replies…</p>
                )}
                {replies.error && (
                  <p className="text-xs text-rose-600">
                    {extractApiError(replies.error, "Failed to load replies.")}
                  </p>
                )}
                <div className="space-y-4">
                  {(replies.data ?? []).map((reply) => (
                    <CommentItem
                      key={reply.id}
                      comment={reply}
                      storyId={_storyId}
                      depth={depth + 1}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      isSubmittingEdit={isSubmittingEdit}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
