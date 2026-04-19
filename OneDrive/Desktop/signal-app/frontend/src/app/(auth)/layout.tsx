"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function AuthLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuth();

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.replace("/feed");
    }
  }, [hasHydrated, isAuthenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold tracking-tight">SIGNAL</h1>
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            Professional intelligence, tailored to you.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
