"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useRequireOnboarded } from "@/hooks/useRequireOnboarded";
import { Header } from "@/components/layout/Header";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { ready } = useRequireOnboarded();
  const pathname = usePathname();
  const isFeed = pathname === "/feed";

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
      {/* `theme-swiss` is applied to the whole authenticated shell (not just
          the feed) so the header, nav, and every page share the Swiss
          palette — warm cream / dark editorial with the terracotta accent —
          instead of the legacy teal default. The dark variant
          (`.dark .theme-swiss`) keeps both modes coherent. */}
      <div className="theme-swiss min-h-screen bg-bg">
        <Header />
        {/* The feed is a full-bleed, fixed-height two-panel surface and owns
            its own layout; every other page keeps the centered, padded
            column. The nav lives in the Header now (no left sidebar). */}
        <main>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeInOut" }}
            >
              {isFeed ? (
                children
              ) : (
                <div className="px-4 py-8 md:px-8">
                  <div className="mx-auto max-w-[1500px] 2xl:max-w-[1760px]">
                    {children}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}
