// Phase 12n.x — native generator registry.
//
// Maps an ingestion_sources.slug (whose adapter_type='native_generator')
// to its NativeGenerator. Mirrors adapters/index.ts. Registered today:
//   - HN-surfaced repo discovery (slug `github-trending-native`, kept from
//     the prior star-based version since the seeded source row and CLI
//     default are keyed on it).
//   - arXiv weekly synthesis (slug `arxiv-synthesis-native`).
//   - HN community synthesis (slug `hn-synthesis-native`).
//   - EDGAR earnings/filing reaction (slug `earnings-reaction-native`).
//   - Semiconductor supply-chain synthesis (slug `supply-chain-synthesis-native`).
//   - Cross-sector causal chain (slug `cross-sector-chain-native`, 12n.4).
//   - Tool spotlight (slug `tool-spotlight-native`, 12n.4).
//   - YouTube episode dispatches (slugs `youtube-*-native`, Tier 2 — one
//     instance per curated channel via YOUTUBE_CHANNELS).

import type { NativeGenerator } from "./types";
import { hnRepoDiscoveryGenerator } from "./hnRepoDiscovery";
import { arxivSynthesisGenerator } from "./arxivSynthesis";
import { hnCommunitySynthesisGenerator } from "./hnCommunitySynthesis";
import { earningsReactionGenerator } from "./earningsReaction";
import { supplyChainSynthesisGenerator } from "./supplyChainSynthesis";
import { crossSectorChainGenerator } from "./crossSectorChain";
import { toolSpotlightGenerator } from "./toolSpotlight";
import { youtubeTranscriptGenerators } from "./youtubeTranscript";

const REGISTRY: Record<string, NativeGenerator> = {
  [hnRepoDiscoveryGenerator.slug]: hnRepoDiscoveryGenerator,
  [arxivSynthesisGenerator.slug]: arxivSynthesisGenerator,
  [hnCommunitySynthesisGenerator.slug]: hnCommunitySynthesisGenerator,
  [earningsReactionGenerator.slug]: earningsReactionGenerator,
  [supplyChainSynthesisGenerator.slug]: supplyChainSynthesisGenerator,
  [crossSectorChainGenerator.slug]: crossSectorChainGenerator,
  [toolSpotlightGenerator.slug]: toolSpotlightGenerator,
  // Phase 12 ingestion Tier 2 — one instance per curated channel (YouTube
  // episode dispatches: slugs `youtube-*-native`, seeded by migration 0054).
  ...Object.fromEntries(youtubeTranscriptGenerators.map((g) => [g.slug, g])),
};

export function getGenerator(slug: string): NativeGenerator | null {
  return REGISTRY[slug] ?? null;
}

export function listGenerators(): NativeGenerator[] {
  return Object.values(REGISTRY);
}
