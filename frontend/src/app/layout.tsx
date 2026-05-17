import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";

// Phase 12j — design system. Three Google Fonts via next/font for
// zero-runtime-cost subsetting + zero FOIT. The CSS variables flow
// into Tailwind's font-family theme extension and the globals.css
// utility classes (.font-display, etc.).
//
//   Newsreader     — editorial serif. Display headlines, page titles,
//                    auth-card headings. "Variable" weight axis is
//                    used between 400 and 700.
//   IBM Plex Sans  — humanist body sans. Default for UI + reading.
//                    Carries tech credibility without sacrificing warmth.
//   JetBrains Mono — numeric / timestamp / SIGNAL-rating contexts.
//                    Used sparingly per the brief.
const fontSerif = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
});

const fontSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SIGNAL",
  description: "Professional intelligence for AI, Finance, and Semiconductor professionals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html
      lang="en"
      className={`${fontSerif.variable} ${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
