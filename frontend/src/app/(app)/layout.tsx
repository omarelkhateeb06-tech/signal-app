"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useRequireOnboarded } from "@/hooks/useRequireOnboarded";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { ready } = useRequireOnboarded();
  const pathname = usePathname();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    // reducedMotion="user" makes every descendant motion component respect
    // the OS-level prefers-reduced-motion setting: transform/layout
    // animations (stagger slide-up, hover lift, save-button scale, depth-
    // toggle pill, page-transition slide) snap to their end state, while
    // opacity fades are preserved. Covers the whole authenticated app.
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-bg">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-[1500px] 2xl:max-w-[1760px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeInOut" }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
