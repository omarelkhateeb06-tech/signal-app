"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAcceptInvite, useInviteMetadata } from "@/hooks/useTeams";
import { extractApiError } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useTeamsStore } from "@/store/teamsStore";
import { Skeleton } from "@/components/ui/Skeleton";
import type { InviteMetadata } from "@/types/team";

type JoinMode = "signup" | "signin";

const signupSchema = z.object({
  password: z.string().min(8, "At least 8 characters"),
  name: z.string().trim().min(1, "Required"),
});

const signinSchema = z.object({
  password: z.string().min(8, "At least 8 characters"),
  name: z.string(),
});

type FormValues = z.infer<typeof signupSchema>;

function CardShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md space-y-5 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <Link
          href="/"
          className="block text-center text-xl font-bold tracking-tight text-slate-900"
        >
          SIGNAL
        </Link>
        {children}
      </div>
    </main>
  );
}

function InviteSummary({ metadata }: { metadata: InviteMetadata }): JSX.Element {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <p className="text-slate-700">
        You&apos;re invited to join{" "}
        <strong className="text-slate-900">{metadata.team_name}</strong> as{" "}
        <span className="font-medium text-slate-900">{metadata.role}</span>.
      </p>
      <p className="mt-1 text-xs text-slate-500">Sent to {metadata.email}</p>
    </div>
  );
}

function JoinTeamInner(): JSX.Element {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated, logout } = useAuth();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);

  const {
    data: metadata,
    isLoading,
    isError,
    error,
  } = useInviteMetadata(token, { enabled: Boolean(token) });
  const acceptMutation = useAcceptInvite();

  const [mode, setMode] = useState<JoinMode>("signup");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(mode === "signup" ? signupSchema : signinSchema),
    defaultValues: { password: "", name: "" },
  });

  const emailMatches = useMemo((): boolean => {
    if (!user || !metadata) return false;
    return user.email.toLowerCase() === metadata.email.toLowerCase();
  }, [user, metadata]);

  if (!token) {
    return (
      <CardShell>
        <StateMessage
          icon={<XCircle className="h-10 w-10 text-rose-500" aria-hidden />}
          title="Invitation link is missing a token"
          body="This link is incomplete. Ask your admin to send you a fresh invite."
        />
      </CardShell>
    );
  }

  if (!hasHydrated || isLoading) {
    return (
      <CardShell>
        <div className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardShell>
    );
  }

  if (isError || !metadata) {
    return (
      <CardShell>
        <StateMessage
          icon={<XCircle className="h-10 w-10 text-rose-500" aria-hidden />}
          title="This invitation link is invalid"
          body={extractApiError(
            error,
            "We couldn't find an invitation matching this link.",
          )}
        />
      </CardShell>
    );
  }

  if (metadata.status === "expired") {
    return (
      <CardShell>
        <StateMessage
          icon={<Clock className="h-10 w-10 text-amber-500" aria-hidden />}
          title="This invitation has expired"
          body="Ask your admin to send you a new invitation."
        />
        <InviteSummary metadata={metadata} />
      </CardShell>
    );
  }

  if (metadata.status === "used") {
    return (
      <CardShell>
        <StateMessage
          icon={<CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden />}
          title="This invitation has already been accepted"
          body="Sign in to continue to your team."
        />
        <Link
          href="/login"
          className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
        >
          Go to sign in
        </Link>
      </CardShell>
    );
  }

  const onAccept = async (values?: Partial<FormValues>): Promise<void> => {
    setSubmitError(null);
    try {
      const payload =
        !isAuthenticated && values
          ? {
              token,
              password: values.password,
              ...(mode === "signup" ? { name: values.name } : {}),
            }
          : { token };
      const result = await acceptMutation.mutateAsync(payload);
      setAuth(result.user, result.token);
      setActiveTeam(result.team.id);
      router.replace(`/teams/${result.team.id}`);
    } catch (err) {
      setSubmitError(
        extractApiError(err, "Couldn't accept the invite. Please try again."),
      );
    }
  };

  if (isAuthenticated && !emailMatches) {
    return (
      <CardShell>
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Different account signed in</p>
            <p className="mt-1">
              This invite was sent to <strong>{metadata.email}</strong> but
              you&apos;re signed in as <strong>{user?.email}</strong>. Log out and
              continue with the invited account.
            </p>
          </div>
        </div>
        <InviteSummary metadata={metadata} />
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
          className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
        >
          Log out and continue
        </button>
      </CardShell>
    );
  }

  if (isAuthenticated && emailMatches) {
    return (
      <CardShell>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Join {metadata.team_name}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            You&apos;re signed in as {user?.email}.
          </p>
        </div>
        <InviteSummary metadata={metadata} />
        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {submitError}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            void onAccept();
          }}
          disabled={acceptMutation.isPending}
          className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {acceptMutation.isPending ? "Joining…" : "Accept invitation"}
        </button>
      </CardShell>
    );
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    await onAccept(values);
  });

  return (
    <CardShell>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Join {metadata.team_name}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "signup"
            ? "Create an account to accept the invitation."
            : "Sign in to accept the invitation."}
        </p>
      </div>

      <InviteSummary metadata={metadata} />

      <div
        role="tablist"
        aria-label="Sign up or sign in"
        className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm"
      >
        {(["signup", "signin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setSubmitError(null);
              form.clearErrors();
            }}
            className={`rounded px-3 py-1.5 font-medium transition ${
              mode === m
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {m === "signup" ? "New to SIGNAL" : "I have an account"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        {mode === "signup" && (
          <div>
            <label
              htmlFor="join-name"
              className="block text-xs font-medium text-slate-700"
            >
              Full name
            </label>
            <input
              id="join-name"
              type="text"
              autoComplete="name"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-rose-600">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
        )}

        <div>
          <label
            htmlFor="join-password"
            className="block text-xs font-medium text-slate-700"
          >
            Password
          </label>
          <input
            id="join-password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="mt-1 text-xs text-rose-600">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={acceptMutation.isPending || form.formState.isSubmitting}
          className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {acceptMutation.isPending
            ? "Joining…"
            : mode === "signup"
              ? "Create account & join"
              : "Sign in & join"}
        </button>
      </form>
    </CardShell>
  );
}

function StateMessage({
  icon,
  title,
  body,
}: {
  icon: JSX.Element;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="space-y-2 text-center">
      <div className="flex justify-center">{icon}</div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-600">{body}</p>
    </div>
  );
}

export default function JoinTeamPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <CardShell>
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardShell>
      }
    >
      <JoinTeamInner />
    </Suspense>
  );
}
