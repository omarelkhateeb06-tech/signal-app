// Phase 12n.x — native generator registry.
//
// Maps an ingestion_sources.slug (whose adapter_type='native_generator')
// to its NativeGenerator. Mirrors adapters/index.ts. Registered today:
//   - HN-surfaced repo discovery (slug `github-trending-native`, kept from
//     the prior star-based version since the seeded source row and CLI
//     default are keyed on it).
//   - arXiv weekly synthesis (slug `arxiv-synthesis-native`).
//   - HN community synthesis (slug `hn-synthesis-native`).
// Later sub-phases add filing / supply-chain generators here.

import type { NativeGenerator } from "./types";
import { hnRepoDiscoveryGenerator } from "./hnRepoDiscovery";
import { arxivSynthesisGenerator } from "./arxivSynthesis";
import { hnCommunitySynthesisGenerator } from "./hnCommunitySynthesis";

const REGISTRY: Record<string, NativeGenerator> = {
  [hnRepoDiscoveryGenerator.slug]: hnRepoDiscoveryGenerator,
  [arxivSynthesisGenerator.slug]: arxivSynthesisGenerator,
  [hnCommunitySynthesisGenerator.slug]: hnCommunitySynthesisGenerator,
};

export function getGenerator(slug: string): NativeGenerator | null {
  return REGISTRY[slug] ?? null;
}

export function listGenerators(): NativeGenerator[] {
  return Object.values(REGISTRY);
}
