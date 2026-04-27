"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { extractApiError, unsubscribeRequest } from "@/lib/api";

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
    <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
          SIGNAL
        </Link>
      </div>
      {status === "pending" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-violet-600" aria-hidden />
          <p className="text-sm text-slate-600">Processing your unsubscribe...</p>
        </div>
      )}
      {status === "success" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden />
          <h1 className="text-xl font-semibold text-slate-900">You&apos;ve been unsubscribed</h1>
          <p className="text-sm text-slate-600">
            We&apos;ll stop sending marketing emails{email ? ` to ${email}` : ""}. You can change this
            any time from your settings.
          </p>
          <Link
            href="/settings"
            className="mt-2 inline-flex items-center rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Manage email preferences
          </Link>
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="h-10 w-10 text-rose-500" aria-hidden />
          <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <Link
            href="/settings"
            className="mt-2 inline-flex items-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to settings
          </Link>
        </div>
      )}
    </div>
  );
}

function UnsubscribeFallback(): JSX.Element {
  return (
    <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-violet-600" aria-hidden />
        <p className="text-sm text-slate-600">Loading...</p>
      </div>
    </div>
  );
}

export default function UnsubscribePage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <Suspense fallback={<UnsubscribeFallback />}>
        <UnsubscribeContent />
      </Suspense>
    </main>
  );
}
