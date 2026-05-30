// Phase 12n.2 — native generator registry.
//
// Maps an ingestion_sources.slug (whose adapter_type='native_generator')
// to its NativeGenerator. Mirrors adapters/index.ts. 12n.2 ships exactly
// one — the HN-surfaced repo discovery generator (slug
// `github-trending-native`, kept from the prior star-based version since
// the seeded source row and CLI default are keyed on it). Later sub-phases
// (12n.4) add arXiv / filing generators by registering them here.

import type { NativeGenerator } from "./types";
import { hnRepoDiscoveryGenerator } from "./hnRepoDiscovery";

const REGISTRY: Record<string, NativeGenerator> = {
  [hnRepoDiscoveryGenerator.slug]: hnRepoDiscoveryGenerator,
};

export function getGenerator(slug: string): NativeGenerator | null {
  return REGISTRY[slug] ?? null;
}

export function listGenerators(): NativeGenerator[] {
  return Object.values(REGISTRY);
}
