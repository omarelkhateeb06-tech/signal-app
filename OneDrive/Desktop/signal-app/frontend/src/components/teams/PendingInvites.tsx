"use client";

import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import {
  useResendInvite,
  useRevokeInvite,
  useTeamInvites,
} from "@/hooks/useTeams";
import { extractApiError } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toast, type ToastTone } from "@/components/ui/Toast";
import type { InviteStatus, PendingTeamInvite, TeamRole } from "@/types/team";

export interface PendingInvitesProps {
  teamId: string;
  isAdmin: boolean;
}

function roleBadgeClass(role: TeamRole): string {
  if (role === "admin") return "bg-blue-100 text-blue-700";
  if (role === "viewer") return "bg-slate-100 text-slate-600";
  return "bg-emerald-100 text-emerald-700";
}

function statusBadgeClass(status: InviteStatus): string {
  if (status === "pending") return "bg-amber-100 text-amber-800";
  if (status === "expired") return "bg-slate-100 text-slate-600";
  if (status === "revoked") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-500";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PendingInvites({
  teamId,
  isAdmin,
}: PendingInvitesProps): JSX.Element {
  const { data: invites, isLoading, error } = useTeamInvites(teamId);
  const resend = useResendInvite(teamId);
  const revoke = useRevokeInvite(teamId);

  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(
    null,
  );
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const pendingCount =
    invites?.filter((i) => i.status === "pending").length ?? 0;

  const onResend = async (invite: PendingTeamInvite): Promise<void> => {
    try {
      await resend.mutateAsync(invite.id);
      setToast({ message: `Invite resent to ${invite.email}`, tone: "success" });
    } catch (err) {
      setToast({
        message: extractApiError(err, "Failed to resend invite."),
        tone: "error",
      });
    }
  };

  const onRevoke = async (): Promise<void> => {
    if (!confirmRevokeId) return;
    const invite = invites?.find((i) => i.id === confirmRevokeId);
    try {
      await revoke.mutateAsync(confirmRevokeId);
      setConfirmRevokeId(null);
      setToast({
        message: invite ? `Invite to ${invite.email} revoked` : "Invite revoked",
        tone: "success",
      });
    } catch (err) {
      setConfirmRevokeId(null);
      setToast({
        message: extractApiError(err, "Failed to revoke invite."),
        tone: "error",
      });
    }
  };

  const pendingInvite = invites?.find((i) => i.id === confirmRevokeId) ?? null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <div className="text-sm font-semibold text-slate-900">
          Pending invites
          {pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {pendingCount}
            </span>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2 px-6 py-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {error && (
        <div className="px-6 py-6 text-center text-sm text-rose-700">
          {extractApiError(error, "Failed to load invites.")}
        </div>
      )}

      {!isLoading && invites && invites.length === 0 && (
        <div className="px-6 py-6 text-center text-sm text-slate-500">
          No invites yet.
        </div>
      )}

      {invites && invites.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {invites.map((invite) => {
            const isPending = invite.status === "pending";
            return (
              <li
                key={invite.id}
                className="flex flex-col gap-2 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">
                    {invite.email}
                  </div>
                  <div className="text-xs text-slate-500">
                    {isPending
                      ? `expires ${formatDate(invite.expires_at)}`
                      : invite.status === "used"
                        ? `accepted ${formatDate(invite.used_at)}`
                        : invite.status === "revoked"
                          ? `revoked ${formatDate(invite.revoked_at)}`
                          : `expired ${formatDate(invite.expires_at)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${roleBadgeClass(invite.role)}`}
                  >
                    {invite.role}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(invite.status)}`}
                  >
                    {invite.status}
                  </span>
                  {isAdmin && isPending && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void onResend(invite);
                        }}
                        disabled={resend.isPending}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Resend invite to ${invite.email}`}
                        title="Resend invite"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(invite.id)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label={`Revoke invite to ${invite.email}`}
                        title="Revoke invite"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(confirmRevokeId)}
        title="Revoke invite?"
        description={
          pendingInvite
            ? `${pendingInvite.email} won't be able to use this invitation link anymore.`
            : undefined
        }
        confirmLabel="Revoke"
        tone="danger"
        isLoading={revoke.isPending}
        onConfirm={() => {
          void onRevoke();
        }}
        onCancel={() => setConfirmRevokeId(null)}
      />

      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}
    </section>
  );
}
