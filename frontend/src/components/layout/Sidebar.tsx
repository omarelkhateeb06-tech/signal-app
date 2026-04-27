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
    <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
      <nav className="sticky top-16 space-y-1 p-4">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
