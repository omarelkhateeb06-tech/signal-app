import { Sparkles } from "lucide-react";

// Phase 12j — restyled onto design tokens. Same loading-vs-text
// branch, same shimmer skeleton, accent-tinted card frame to match
// the Commentary surface. The skeleton shimmer pulses against the
// tinted background so loading feels intentional, not broken.

interface PersonalizationBoxProps {
  // Final commentary to display. Null/undefined = loading skeleton.
  text: string | null | undefined;
  // Phase 12c: when true, render the shimmer skeleton instead of text.
  loading?: boolean;
}

function CommentarySkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">Generating your personalized commentary</span>
      <div className="skeleton h-3 w-[95%] rounded" />
      <div className="skeleton h-3 w-[88%] rounded" />
      <div className="skeleton h-3 w-[60%] rounded" />
    </div>
  );
}

export function PersonalizationBox({
  text,
  loading,
}: PersonalizationBoxProps): JSX.Element {
  const showSkeleton = loading || text === null || text === undefined;

  return (
    <div
      className="flex gap-3 rounded-lg border p-5"
      style={{
        backgroundColor: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--accent) 22%, var(--line))",
      }}
    >
      <Sparkles className="mt-1 h-4 w-4 flex-shrink-0 text-accent" />
      <div className="flex-1 space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
          Why it matters
        </p>
        {showSkeleton ? (
          <CommentarySkeleton />
        ) : (
          <p className="text-[15px] leading-[1.7] text-ink">{text}</p>
        )}
      </div>
    </div>
  );
}
