export interface SkeletonProps {
  className?: string;
  "aria-label"?: string;
}

export function Skeleton({
  className = "",
  "aria-label": ariaLabel = "Loading",
}: SkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`animate-pulse rounded-md bg-slate-200 ${className}`}
    />
  );
}
