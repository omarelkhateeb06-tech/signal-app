"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function TeamsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("Teams route error:", error);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-md rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="space-y-3">
          <div>
            <p className="font-semibold">Something went wrong loading this page</p>
            <p className="mt-1 text-rose-800">
              This is likely temporary. Try again, or return to your teams list.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md bg-rose-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
            >
              Try again
            </button>
            <Link
              href="/teams"
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100"
            >
              Back to teams
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
