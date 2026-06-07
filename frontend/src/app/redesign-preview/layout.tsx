import { notFound } from "next/navigation";

// Gate the dev-only redesign showcase out of production. The page renders
// self-contained mock data (no backend) and is a build/QA surface only — it
// must not be reachable on the public site. In any non-production build it
// stays available for local visual work. (Roadmap §14 / §20.6 pre-launch item.)
export default function RedesignPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return children;
}
