"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bookmark, Home, Search, Settings } from "lucide-react";

const NAV: Array<{ href: string; label: string; icon: typeof Home }> = [
  { href: "/feed", label: "Feed", icon: Home },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar(): JSX.Element {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 border-r border-line bg-bg md:block">
      <nav className="sticky top-14 space-y-0.5 p-4">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-surface font-semibold text-ink shadow-card"
                  : "font-medium text-ink-muted hover:bg-line/40 hover:text-ink",
              )}
            >
              {/* Active accent bar — the only place the teal accent marks
                  location, matching the landing-page nav language. */}
              <span
                aria-hidden
                className={clsx(
                  "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                className={clsx(
                  "h-4 w-4 transition-colors",
                  active ? "text-accent" : "text-ink-muted group-hover:text-ink",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
