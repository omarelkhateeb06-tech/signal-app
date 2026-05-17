import type { Config } from "tailwindcss";

// Phase 12j — design tokens. CSS variables live in globals.css at
// :root level; this config wires them into Tailwind's color theme.
// The shadcn-style HSL variables (--background, --foreground, etc.)
// are preserved for the handful of legacy ui/* primitives that still
// reference them; new code references the new tokens directly
// (bg-bg, text-ink, etc.).

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        // Reading-oriented surface — narrower than the typical SaaS
        // container. The 12j brief calls for a 680–720px feed column.
        DEFAULT: "100%",
        sm: "100%",
        md: "100%",
        lg: "720px",
        xl: "720px",
        "2xl": "720px",
      },
    },
    extend: {
      // ----- New design tokens (12j) -----
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-serif)", "Georgia", "serif"],
      },
      colors: {
        // Surfaces + text
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--ink-muted)",
        },
        line: "var(--line)",
        // Primary accent (CTAs / links / focus)
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          fg: "var(--accent-fg)",
        },
        // Sector accents. Used as left-borders, dots, badge backgrounds,
        // section-header underlines.
        sector: {
          ai: "var(--ai)",
          finance: "var(--finance)",
          semis: "var(--semis)",
        },
        // Semantic
        ok: "var(--ok)",
        warn: "var(--warn)",
        err: "var(--err)",

        // ----- Legacy shadcn tokens (kept so existing ui/* primitives
        // don't break; values redirected to the new palette in globals
        // so they look right with the new design without a code touch).
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "10px",
        md: "8px",
        sm: "6px",
        pill: "9999px",
      },
      boxShadow: {
        // Subtle elevation for cards. The two-stop pattern is what
        // makes the surface feel "lifted" without a harsh drop shadow.
        card: "0 1px 2px rgba(26,24,22,0.04), 0 2px 6px rgba(26,24,22,0.04)",
        "card-hover":
          "0 2px 4px rgba(26,24,22,0.06), 0 8px 24px rgba(26,24,22,0.06)",
        modal: "0 8px 32px rgba(26,24,22,0.16)",
      },
      keyframes: {
        // Feed card stagger entrance — opacity + a 4px upward translate.
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Trial-badge pulse at ≤1 day remaining. Slow opacity breathe;
        // not a hard flash.
        breathe: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        "shimmer-x": {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        breathe: "breathe 2.8s ease-in-out infinite",
        shimmer: "shimmer-x 1.6s linear infinite",
      },
      transitionTimingFunction: {
        "soft-out": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      maxWidth: {
        reading: "720px",
      },
    },
  },
  plugins: [],
};

export default config;
