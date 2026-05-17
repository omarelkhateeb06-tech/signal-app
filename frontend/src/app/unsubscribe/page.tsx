"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { extractApiError, unsubscribeRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Status = "pending" | "success" | "error";

function UnsubscribeContent(): JSX.Element {
  const params = useSearchParams();
  const token = params?.get("token") ?? "";
  const [status, setStatus] = useState<Status>("pending");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This unsubscribe link is missing a token.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await unsubscribeRequest(token);
        if (cancelled) return;
        setEmail(result.email);
        setStatus("success");
      } catch (err) {
        if (cancelled) return;
        setError(extractApiError(err, "We couldn't process this unsubscribe link."));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Card className="w-full max-w-md p-8">
      <div className="mb-6 text-center">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-[0.18em] text-ink hover:no-underline"
        >
          SIGNAL
        </Link>
      </div>
      {status === "pending" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-accent" aria-hidden />
          <p className="text-sm text-ink-muted">Processing your unsubscribe…</p>
        </div>
      )}
      {status === "success" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
          <h1 className="font-display text-[22px] font-semibold text-ink">
            You&apos;ve been unsubscribed
          </h1>
          <p className="text-sm leading-relaxed text-ink-muted">
            We&apos;ll stop sending the SIGNAL daily digest
            {email ? ` to ${email}` : ""}. You can re-enable it any time from your
            settings.
          </p>
          <Link
            href="/feed"
            className="mt-2 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover hover:no-underline"
          >
            Back to SIGNAL →
          </Link>
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <XCircle className="h-10 w-10 text-err" aria-hidden />
          <h1 className="font-display text-[22px] font-semibold text-ink">
            Something went wrong
          </h1>
          <p className="text-sm text-ink-muted">{error}</p>
          <Link
            href="/settings"
            className="mt-2 inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-muted hover:no-underline"
          >
            Go to settings
          </Link>
        </div>
      )}
    </Card>
  );
}

function UnsubscribeFallback(): JSX.Element {
  return (
    <Card className="w-full max-w-md p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-accent" aria-hidden />
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    </Card>
  );
}

export default function UnsubscribePage(): JSX.Element {
  // Touch Button so it stays in the import graph for future use in
  // this file — currently the page renders Link-as-button. Lint
  // configurations that drop unused imports can strip this.
  void Button;
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <Suspense fallback={<UnsubscribeFallback />}>
        <UnsubscribeContent />
      </Suspense>
    </main>
  );
}
