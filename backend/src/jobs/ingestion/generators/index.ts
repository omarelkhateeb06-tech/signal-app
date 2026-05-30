// Phase 12n.2 — native generator registry.
//
// Maps an ingestion_sources.slug (whose adapter_type='native_generator')
// to its NativeGenerator. Mirrors adapters/index.ts. 12n.2 ships exactly
// one — GitHub trending; later sub-phases (12n.4) add arXiv / HN / filing
// generators by registering them here.

import type { NativeGenerator } from "./types";
import { githubTrendingGenerator } from "./githubTrending";

const REGISTRY: Record<string, NativeGenerator> = {
  [githubTrendingGenerator.slug]: githubTrendingGenerator,
};

export function getGenerator(slug: string): NativeGenerator | null {
  return REGISTRY[slug] ?? null;
}

export function listGenerators(): NativeGenerator[] {
  return Object.values(REGISTRY);
}
