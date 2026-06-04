import type { Story } from "@/types/story";

// Phase 13 — the visible personalization layer the whole board converged
// on. Built entirely from data already on the client (the user's rank
// position, whether the story is in a sector they follow, how widely it's
// covered) — no per-card Haiku call. It makes "this is in YOUR feed, and
// here's why" a thing you can SEE on every card, so two readers' feeds
// read differently instead of byte-identical.

const SECTOR_SHORT: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

export function RelevanceLine({
  story,
  rank,
  followed = false,
  className,
}: {
  story: Story;
  rank?: number;
  followed?: boolean;
  className?: string;
}): JSX.Element | null {
  const sources = story.sources.length;
  if (rank == null && !followed && sources <= 1) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] ${className ?? ""}`}
    >
      {rank != null && <span className="text-accent">#{rank} for you</span>}
      {followed && (
        <span className="text-ink-muted">
          · {SECTOR_SHORT[story.sector] ?? story.sector} · your focus
        </span>
      )}
      {sources > 1 && (
        <span className="text-ink-muted">· {sources} sources tracking</span>
      )}
    </div>
  );
}
