// Phase C — native-post illustration generation.
//
// Generates an editorial illustration for each native post on publish and
// stores the URL in events.illustration_url. Four visual archetypes map to
// the seven generator slugs so every card type has a coherent, on-brand look.
//
// The only hard dep is HIGGSFIELD_API_KEY. The service is entirely soft-fail:
// any error (missing key, API error, timeout) logs + returns null so the
// publish step is never blocked on image generation.
//
// API: Higgsfield REST — POST https://api.higgsfield.ai/v1/generation/image
// Model: nano_banana_2 (same model the banana MCP uses for in-session generation).
// ~1 credit per image. Response is synchronous — no polling required.

import { eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import { events } from "../db/schema";

const HIGGSFIELD_API_URL = "https://api.higgsfield.ai/v1/generation/image";

// ── 4 visual archetypes ────────────────────────────────────────────────────
//
// Brand palette reference (from Tailwind tokens in globals.css):
//   bg: #0f0d0a  ink: #e8e0d0  accent: #c8843a  line: #2a2520
//   finance: #4ade80  err: #ef4444

export type IllustrationArchetype =
  | "convergence"  // cross-sector-chain-native → THE CONNECTION
  | "research"     // arxiv-synthesis-native → THE RESEARCH READ
  | "market"       // earnings-reaction-native, supply-chain-synthesis-native
  | "signal";      // github-trending-native, tool-spotlight-native, hn-synthesis-native

// Maps ingestion_sources.slug → archetype.
const SLUG_TO_ARCHETYPE: Record<string, IllustrationArchetype> = {
  "cross-sector-chain-native":       "convergence",
  "arxiv-synthesis-native":          "research",
  "earnings-reaction-native":        "market",
  "supply-chain-synthesis-native":   "market",
  "github-trending-native":          "signal",
  "tool-spotlight-native":           "signal",
  "hn-synthesis-native":             "signal",
};

const DEFAULT_ARCHETYPE: IllustrationArchetype = "signal";

const ARCHETYPES: Record<IllustrationArchetype, string> = {
  convergence:
    "Editorial magazine illustration: three converging data streams representing artificial intelligence, finance, and semiconductors rendered as an abstract node-and-edge graph. Dark charcoal background #0f0d0a, amber-gold accent lines #c8843a, cream node points #e8e0d0. Minimalist Swiss editorial style, no text, no labels, no human figures.",
  research:
    "Editorial magazine illustration: a scholarly research manuscript page with ghosted mathematical notation, circuit-diagram lines, and abstract data curves on warm cream paper. Ink-wash aesthetic, charcoal and amber tones. Evokes a high-end academic journal cover. No text, no letters, no human figures.",
  market:
    "Editorial magazine illustration: a financial data visualization with clean orthogonal grid lines, candlestick-style bars, and a flowing trend curve on a deep charcoal background. Amber highlights, emerald green accents, crimson for decline. Bloomberg terminal meets editorial art. No text, no numbers, no human figures.",
  signal:
    "Editorial magazine illustration: a monochrome terminal interface window with amber glow on deep charcoal background. Abstract code-motif lines, geometric circuit traces, and glowing cursor shapes. Tech-editorial aesthetic, dark and precise. No readable text, no human figures, no logos.",
};

// ── Higgsfield REST client ─────────────────────────────────────────────────

interface HiggsfieldResponse {
  images?: Array<{ url: string }>;
  // The API may return the URL directly at different keys depending on model.
  url?: string;
}

async function callHiggsfield(prompt: string): Promise<string> {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error("HIGGSFIELD_API_KEY not set");

  const res = await fetch(HIGGSFIELD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${key}`,
    },
    body: JSON.stringify({
      model: "nano_banana_2",
      prompt,
      aspect_ratio: "16:9",
    }),
    signal: AbortSignal.timeout(60_000), // 60s — generation can take ~20–30s
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as HiggsfieldResponse;
  const url = json.images?.[0]?.url ?? json.url;
  if (!url) throw new Error("Higgsfield response missing image URL");
  return url;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface IllustrationResult {
  url: string;
  archetype: IllustrationArchetype;
}

// Generate an illustration for a published native event and store it.
// Soft-fail: any error returns null and logs — the caller is never blocked.
export async function generateAndStoreIllustration(
  eventId: string,
  generatorSlug: string,
  deps: { db?: typeof defaultDb } = {},
): Promise<IllustrationResult | null> {
  const db = deps.db ?? defaultDb;

  if (!process.env.HIGGSFIELD_API_KEY) {
    return null;
  }

  const archetype = SLUG_TO_ARCHETYPE[generatorSlug] ?? DEFAULT_ARCHETYPE;
  const prompt = ARCHETYPES[archetype];

  try {
    const url = await callHiggsfield(prompt);

    await db
      .update(events)
      .set({ illustrationUrl: url })
      .where(eq(events.id, eventId));

    return { url, archetype };
  } catch (err) {
    console.error(
      `[illustrationService] soft-fail for event=${eventId} slug=${generatorSlug}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export function resolveArchetype(slug: string): IllustrationArchetype {
  return SLUG_TO_ARCHETYPE[slug] ?? DEFAULT_ARCHETYPE;
}
