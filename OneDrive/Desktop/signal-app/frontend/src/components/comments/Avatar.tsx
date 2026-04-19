import clsx from "clsx";

interface AvatarProps {
  name: string | null;
  email: string;
  url?: string | null;
  className?: string;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, email, url, className }: AvatarProps): JSX.Element {
  const classes = clsx(
    "flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700",
    className,
  );
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? email}
        className={clsx("h-8 w-8 rounded-full object-cover", className)}
      />
    );
  }
  return <div className={classes}>{initials(name, email)}</div>;
}
