import Link from "next/link";

export default function HomePage(): JSX.Element {
  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="max-w-2xl space-y-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">SIGNAL</h1>
        <p className="text-lg text-muted-foreground">
          Professional intelligence for AI, Finance, and Semiconductor professionals.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}
