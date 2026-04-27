import { Sparkles } from "lucide-react";

interface PersonalizationBoxProps {
  // Final commentary to display. Null/undefined = loading skeleton.
  text: string | null | undefined;
  // Phase 12c: when true, render the shimmer skeleton instead of text.
  // Separated from text-null because we want to show the header chrome
  // (icon + "Why it matters to you") immediately and only swap the
  // body between skeleton and commentary.
  loading?: boolean;
}

// Three-line shimmer that visually matches the commentary density
// produced by DEPTH_GUIDANCE["briefed"] (~120-160 words, ~3 lines in
// the feed card width). Using pulse rather than a moving gradient
// because tailwind ships it out of the box and it doesn't fight
// React 18 StrictMode's double-render in dev.
function CommentarySkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">Generating your personalized commentary</span>
      <div className="h-3 w-[95%] animate-pulse rounded bg-violet-200/80" />
      <div className="h-3 w-[88%] animate-pulse rounded bg-violet-200/70" />
      <div className="h-3 w-[60%] animate-pulse rounded bg-violet-200/60" />
    </div>
  );
}

export function PersonalizationBox({ text, loading }: PersonalizationBoxProps): JSX.Element {
  const showSkeleton = loading || text === null || text === undefined;

  return (
    <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600" />
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
          Why it matters to you
        </p>
        {showSkeleton ? (
          <CommentarySkeleton />
        ) : (
          <p className="text-sm leading-relaxed text-slate-800">{text}</p>
        )}
      </div>
    </div>
  );
}
