"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useInviteTeamMember,
  useRemoveTeamMember,
  useTeam,
  useTeamMembers,
} from "@/hooks/useTeams";
import { extractApiError } from "@/lib/api";
import { PendingInvites } from "@/components/teams/PendingInvites";
import type { TeamInvite, TeamRole } from "@/types/team";

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(["admin", "member", "viewer"]),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

function roleBadgeClass(role: TeamRole): string {
  if (role === "admin") return "bg-blue-100 text-blue-700";
  if (role === "viewer") return "bg-slate-100 text-slate-600";
  return "bg-emerald-100 text-emerald-700";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TeamMembersPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;
  const { user } = useAuth();

  const { data: team } = useTeam(teamId);
  const { data: members, isLoading, error } = useTeamMembers(teamId);
  const inviteMember = useInviteTeamMember(teamId ?? "");
  const removeMember = useRemoveTeamMember(teamId ?? "");

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<TeamInvite | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member" },
  });

  if (!teamId) notFound();

  const isAdmin = team?.role === "admin";
  const adminCount = members?.filter((m) => m.role === "admin").length ?? 0;

  const onInvite = handleSubmit(async (values) => {
    setInviteError(null);
    setLastInvite(null);
    try {
      const invite = await inviteMember.mutateAsync({
        email: values.email,
        role: values.role,
      });
      setLastInvite(invite);
      reset({ email: "", role: "member" });
    } catch (err) {
      setInviteError(extractApiError(err, "Failed to send invite."));
    }
  });

  const onRemove = async (userId: string, name: string): Promise<void> => {
    setRemoveError(null);
    const confirmed = window.confirm(`Remove ${name} from the team?`);
    if (!confirmed) return;
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      setRemoveError(extractApiError(err, "Failed to remove member."));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          href={`/teams/${teamId}`}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← Back to team
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Members</h1>
        <p className="mt-1 text-sm text-slate-500">
          {team?.name ?? "Team"} · {members?.length ?? 0} members
        </p>
      </header>

      {isAdmin && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Invite someone</h2>
          <form onSubmit={onInvite} className="space-y-3" noValidate>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <label htmlFor="invite-email" className="sr-only">
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="teammate@company.com"
                  className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  {...register("email")}
                />
              </div>
              <div>
                <label htmlFor="invite-role" className="sr-only">
                  Role
                </label>
                <select
                  id="invite-role"
                  className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  {...register("role")}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Sending…" : "Invite"}
              </button>
            </div>
            {errors.email && (
              <p className="text-xs text-rose-600">{errors.email.message}</p>
            )}
            {inviteError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {inviteError}
              </div>
            )}
            {lastInvite && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Invite sent to {lastInvite.email}.
              </div>
            )}
          </form>
        </section>
      )}

      <PendingInvites teamId={teamId} isAdmin={isAdmin} />

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900">
          Current members
        </div>
        {removeError && (
          <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800">
            {removeError}
          </div>
        )}
        {isLoading && (
          <div className="px-6 py-6 text-center text-sm text-slate-500">Loading…</div>
        )}
        {error && (
          <div className="px-6 py-6 text-center text-sm text-rose-700">
            {extractApiError(error, "Failed to load members.")}
          </div>
        )}
        {!isLoading && members && members.length === 0 && (
          <div className="px-6 py-6 text-center text-sm text-slate-500">
            No members yet.
          </div>
        )}
        {members && members.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {members.map((m) => {
              const isSelf = user?.id === m.user_id;
              const isLastAdmin = m.role === "admin" && adminCount === 1;
              const canRemove = isAdmin && !isSelf && !isLastAdmin;
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">
                      {m.name ?? m.email}
                      {isSelf && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (you)
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {m.email} · joined {formatDate(m.joined_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${roleBadgeClass(m.role)}`}
                    >
                      {m.role}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => onRemove(m.user_id, m.name ?? m.email)}
                        disabled={!canRemove || removeMember.isPending}
                        title={
                          isSelf
                            ? "You can't remove yourself"
                            : isLastAdmin
                              ? "Can't remove the last admin"
                              : "Remove member"
                        }
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                        aria-label={`Remove ${m.name ?? m.email}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
