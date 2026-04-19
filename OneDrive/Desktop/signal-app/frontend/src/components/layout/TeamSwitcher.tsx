"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";

function roleBadgeClass(role: string | undefined): string {
  if (role === "admin") return "bg-primary text-primary-foreground";
  if (role === "viewer") return "bg-muted text-muted-foreground";
  return "bg-secondary text-secondary-foreground";
}

export function TeamSwitcher(): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { data: teams = [], isLoading } = useTeams();
  const activeTeamId = useTeamsStore((s) => s.activeTeamId);
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);

  const active = teams.find((t) => t.id === activeTeamId) ?? null;

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleSelect = (teamId: string): void => {
    setActiveTeam(teamId);
    setOpen(false);
    router.push(`/teams/${teamId}`);
  };

  const handleClearActive = (): void => {
    setActiveTeam(null);
    setOpen(false);
    router.push("/feed");
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch team"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden max-w-[120px] truncate sm:inline">
          {active ? active.name : "Personal"}
        </span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-md border bg-card shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            onClick={handleClearActive}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
              activeTeamId === null ? "bg-accent" : ""
            }`}
          >
            <span>Personal feed</span>
          </button>

          <div className="border-t" />

          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Loading teams…
            </div>
          )}

          {!isLoading && teams.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              You&apos;re not on any teams yet.
            </div>
          )}

          {teams.map((team) => (
            <button
              key={team.id}
              role="menuitem"
              type="button"
              onClick={() => handleSelect(team.id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                activeTeamId === team.id ? "bg-accent" : ""
              }`}
            >
              <span className="truncate">{team.name}</span>
              {team.role && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadgeClass(team.role)}`}
                >
                  {team.role}
                </span>
              )}
            </button>
          ))}

          <div className="border-t" />
          <Link
            role="menuitem"
            href="/teams/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create team
          </Link>
          <Link
            role="menuitem"
            href="/teams"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t px-3 py-2 text-sm hover:bg-accent"
          >
            <Users className="h-4 w-4" aria-hidden />
            All teams
          </Link>
        </div>
      )}
    </div>
  );
}
