"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bookmark, LogOut, Search, Settings, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TeamSwitcher } from "@/components/layout/TeamSwitcher";
import { TrialBadge } from "@/components/layout/TrialBadge";

// Phase 12j — top navigation. Fixed top bar, full-width, page-bg
// shaded one notch darker than the body so it visually separates
// without a hard line. Wordmark left (serif "SIGNAL", tracked wide),
// trial badge + search + saved + avatar right. Mobile: same right-
// rail, no hamburger — at this surface count it's not warranted.

function initials(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 1).toUpperCase();
}

export function Header(): JSX.Element {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  const handleLogout = async (): Promise<void> => {
    setOpen(false);
    await logout();
    router.replace("/login");
  };

  return (
    <header
      className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/65"
    >
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <Link
          href="/feed"
          className="font-display text-lg font-semibold tracking-[0.2em] text-ink transition-colors hover:text-accent hover:no-underline"
        >
          SIGNAL
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {user && <TrialBadge />}
          {user && <TeamSwitcher />}
          <button
            type="button"
            onClick={() => router.push("/search")}
            aria-label="Search (Ctrl+K)"
            title="Search (Ctrl+K)"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-line bg-bg px-1 font-mono text-[10px] text-ink-muted sm:inline">
              ⌘K
            </kbd>
          </button>
          {user && (
            <Link
              href="/saved"
              aria-label="Saved stories"
              title="Saved"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-line/60 hover:text-ink"
            >
              <Bookmark className="h-4 w-4" />
            </Link>
          )}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Open profile menu"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-1 py-0.5 text-sm transition-colors hover:border-ink-muted"
              >
                {user.profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.profilePictureUrl}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-fg">
                    {initials(user.name, user.email)}
                  </span>
                )}
              </button>
              {open && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 overflow-hidden rounded-md border border-line bg-surface shadow-card animate-fade-up"
                >
                  <Link
                    role="menuitem"
                    href="/settings"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-bg hover:no-underline"
                  >
                    <Settings className="h-4 w-4 text-ink-muted" aria-hidden />
                    Settings
                  </Link>
                  <Link
                    role="menuitem"
                    href="/onboarding"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-bg hover:no-underline"
                  >
                    <UserIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                    Interests
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-ink hover:bg-bg"
                  >
                    <LogOut className="h-4 w-4 text-ink-muted" aria-hidden />
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
