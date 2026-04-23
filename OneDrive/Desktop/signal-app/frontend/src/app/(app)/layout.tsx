"use client";

import { useRequireOnboarded } from "@/hooks/useRequireOnboarded";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  // Phase 12b: the app shell now gates on both auth AND completed
  // onboarding. useRequireOnboarded redirects to /onboarding/1 when
  // the profile's completed_at is null, otherwise returns ready=true.
  const { ready } = useRequireOnboarded();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
