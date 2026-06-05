import type { Metadata } from "next";
import { DM_Mono, IBM_Plex_Sans, Lora, Playfair_Display } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";

// Design system — the Swiss editorial type stack, matching the briefing
// design. Four Google Fonts via next/font for zero-runtime-cost subsetting
// + zero FOIT. The CSS variables flow into Tailwind's font-family theme
// extension and the globals.css utility classes (.font-display, etc.).
//
//   Playfair Display — high-contrast display serif. Masthead wordmark,
//                      headlines, story titles (--font-display).
//   Lora             — warm reading serif. Body prose, pull-quotes, the
//                      italic "why it matters" / preview text (--font-serif).
//   IBM Plex Sans    — humanist body sans. UI chrome, forms, nav.
//   DM Mono          — metadata / labels / badges / depth toggle / kickers.
const fontDisplay = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const fontSerif = Lora({
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

const fontMono = DM_Mono({
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
      className={`${fontDisplay.variable} ${fontSerif.variable} ${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Phase 12v — set the theme class before first paint so dark mode
            never flashes. Reads the saved choice, falls back to the OS
            preference. Inlined (not a module) so it runs synchronously in
            <head> ahead of body render. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen bg-bg font-serif text-ink antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
