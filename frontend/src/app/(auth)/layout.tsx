"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/Card";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuth();

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.replace("/beliefs");
    }
  }, [hasHydrated, isAuthenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <Card className="w-full max-w-[400px] space-y-6 p-8">
        <div className="text-center">
          <Link
            href="/"
            className="inline-block font-display text-xl font-semibold tracking-[0.18em] text-ink hover:no-underline"
          >
            SIGNAL
          </Link>
          <p className="mt-2 text-sm text-ink-muted">
            Professional intelligence, tailored to you.
          </p>
        </div>
        {children}
      </Card>
    </main>
  );
}
