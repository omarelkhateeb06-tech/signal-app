"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Phase 12v — dark-mode toggle. The actual theme class is set pre-paint
// by the inline script in layout.tsx (reads localStorage `theme`, falls
// back to the OS preference) so there's no flash. This control just
// flips the `.dark` class on <html> and persists the choice. We read the
// initial state in an effect (not during render) to stay SSR-safe.
export function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = (): void => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage can throw in private-mode / blocked-cookie contexts;
      // the toggle still works for the session, it just won't persist.
    }
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-line/60 hover:text-ink"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
