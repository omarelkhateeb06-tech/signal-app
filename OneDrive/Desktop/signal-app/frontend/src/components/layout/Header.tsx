"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

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

  const handleLogout = async (): Promise<void> => {
    setOpen(false);
    await logout();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/feed" className="text-lg font-bold tracking-tight">
          SIGNAL
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/feed" className="text-muted-foreground hover:text-foreground">
            Feed
          </Link>
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Open profile menu"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border px-2 py-1 text-sm hover:bg-accent"
              >
                {user.profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.profilePictureUrl}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                    {initials(user.name, user.email)}
                  </span>
                )}
                <span className="hidden sm:inline">{user.name ?? user.email}</span>
              </button>
              {open && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 overflow-hidden rounded-md border bg-card shadow-lg"
                >
                  <Link
                    role="menuitem"
                    href="/settings"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Settings className="h-4 w-4" aria-hidden />
                    Settings
                  </Link>
                  <Link
                    role="menuitem"
                    href="/onboarding"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <UserIcon className="h-4 w-4" aria-hidden />
                    Interests
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
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
