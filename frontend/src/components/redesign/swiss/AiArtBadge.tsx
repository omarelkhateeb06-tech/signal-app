import clsx from "clsx";

// Honest labelling for AI-generated editorial illustrations (Roadmap §6.18 /
// §15 / §20.3: "Label AI-generated images as such in the UI"). These appear
// only on native-post art (events.illustration_url) — never on real sourced
// og:images — so the badge is shown by the caller only when the displayed
// image came from illustration_url.
//
// `sm` is the corner tag for small thumbnails (88px row tiles); the default is
// the fuller tag for hero / feature / detail imagery.
export function AiArtBadge({ size = "md" }: { size?: "sm" | "md" }): JSX.Element {
  return (
    <span
      className={clsx(
        "absolute z-10 inline-flex items-center bg-bg/85 font-mono font-semibold uppercase tracking-[0.16em] text-ink-muted backdrop-blur-sm",
        size === "sm"
          ? "bottom-1 right-1 px-1 py-0.5 text-[8px] tracking-[0.12em]"
          : "bottom-2 right-2 px-1.5 py-0.5 text-[9px]",
      )}
      title="AI-generated illustration"
    >
      {size === "sm" ? "AI" : "AI Illustration"}
    </span>
  );
}
