import clsx from "clsx";
import { signalRatingTone } from "./swissView";

// SIGNAL rating badge — the 0–100 credibility/quality score (§1 differentiator).
// `compact` is a single tinted "◆NN" for the feed kicker; `full` is the bigger
// number + band label for the story detail. The score itself is computed
// server-side (source tier + corroboration); this only renders it.
export function SignalRating({
  score,
  variant = "compact",
}: {
  score: number;
  variant?: "compact" | "full";
}): JSX.Element {
  const { label, cls } = signalRatingTone(score);
  const title = `SIGNAL rating ${score}/100 (${label}) — credibility from source tier + corroboration`;

  if (variant === "full") {
    return (
      <div className="inline-flex items-baseline gap-2" title={title}>
        <span className={clsx("font-mono text-[20px] font-bold leading-none", cls)}>
          {score}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
          SIGNAL rating · {label}
        </span>
      </div>
    );
  }

  return (
    <span className={clsx("inline-flex items-center gap-1", cls)} title={title}>
      <span aria-hidden>◆</span>
      {score}
    </span>
  );
}
