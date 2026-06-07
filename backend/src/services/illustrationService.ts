// Phase C — native-post illustration generation.
//
// Generates an editorial illustration for each native post on publish and
// stores the URL in events.illustration_url. Four visual archetypes map to
// the seven generator slugs so every card type has a coherent, on-brand look.
//
// The only hard dep is RECRAFT_API_KEY. The service is entirely soft-fail:
// any error (missing key, API error, timeout) logs + returns null so the
// publish step is never blocked on image generation.
//
// API: Recraft REST — POST https://external.api.recraft.ai/v1/images/generations
// Model: recraftv3 / style: digital_illustration at 16:9 (1365x768).
// ~1–2 credits per image. No polling required — the endpoint is synchronous.

import { eq } from "drizzle-orm";
import { db as defaultDb } from "../db";
import { events } from "../db/schema";

const RECRAFT_API_URL =
  "https://external.api.recraft.ai/v1/images/generations";

// ── 4 visual archetypes ────────────────────────────────────────────────────
//
// Each archetype defines the base prompt and Recraft style. The generator's
// headline is appended as a subject hint so identical archetypes still
// produce contextually varied images.
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

interface ArchetypeConfig {
  prompt: string;
  style: string;
  substyle?: string;
}

const ARCHETYPES: Record<IllustrationArchetype, ArchetypeConfig> = {
  convergence: {
    prompt:
      "Editorial magazine illustration: three converging data streams representing artificial intelligence, finance, and semiconductors rendered as an abstract node-and-edge graph. Dark charcoal background (#0f0d0a), amber-gold accent lines (#c8843a), cream node points (#e8e0d0). Minimalist Swiss editorial style, no text, no labels, no human figures.",
    style: "digital_illustration",
    substyle: "flat_2",
  },
  research: {
    prompt:
      "Editorial magazine illustration: a scholarly research manuscript page with ghosted mathematical notation, circuit-diagram lines, and abstract data curves on warm cream paper (#e8e0d0). Ink-wash aesthetic, charcoal and amber tones (#0f0d0a, #c8843a). Evokes a high-end academic journal cover. No text, no letters, no human figures.",
    style: "digital_illustration",
    substyle: "hand_drawn",
  },
  market: {
    prompt:
      "Editorial magazine illustration: a financial data visualization — clean orthogonal grid lines, candlestick-style bars, and a flowing trend curve on a deep charcoal background (#0f0d0a). Amber highlights (#c8843a), emerald green accents (#4ade80), crimson for decline. Bloomberg terminal meets editorial art. No text, no numbers, no human figures.",
    style: "digital_illustration",
    substyle: "flat_2",
  },
  signal: {
    prompt:
      "Editorial magazine illustration: a monochrome terminal interface window with amber glow (#c8843a) on deep charcoal background (#0f0d0a). Abstract code-motif lines, geometric circuit traces, and glowing cursor shapes. Tech-editorial aesthetic, dark and precise. No readable text, no human figures, no logos.",
    style: "digital_illustration",
    substyle: "flat_2",
  },
};

// ── Recraft REST client ────────────────────────────────────────────────────

interface RecraftResponse {
  data: Array<{ url: string }>;
}

async function callRecraft(prompt: string, style: string): Promise<string> {
  const key = process.env.RECRAFT_API_KEY;
  if (!key) throw new Error("RECRAFT_API_KEY not set");

  const res = await fetch(RECRAFT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "recraftv3",
      prompt,
      style,
      size: "1365x768", // closest 16:9 that Recraft supports
    }),
    signal: AbortSignal.timeout(30_000), // 30s hard timeout
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Recraft API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as RecraftResponse;
  const url = json.data?.[0]?.url;
  if (!url) throw new Error("Recraft response missing data[0].url");
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

  if (!process.env.RECRAFT_API_KEY) {
    // Silent skip — not a misconfiguration in dev, just an optional feature.
    return null;
  }

  const archetype = SLUG_TO_ARCHETYPE[generatorSlug] ?? DEFAULT_ARCHETYPE;
  const config = ARCHETYPES[archetype];

  try {
    const url = await callRecraft(config.prompt, config.style);

    await db
      .update(events)
      .set({ illustrationUrl: url })
      .where(eq(events.id, eventId));

    return { url, archetype };
  } catch (err) {
    // Non-fatal — illustration is a visual enhancement, not a content gate.
    console.error(
      `[illustrationService] soft-fail for event=${eventId} slug=${generatorSlug}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// Resolve the archetype for a given generator slug (exported for tests +
// the backfill script which needs to log which archetype it picked).
export function resolveArchetype(slug: string): IllustrationArchetype {
  return SLUG_TO_ARCHETYPE[slug] ?? DEFAULT_ARCHETYPE;
}
