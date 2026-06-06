"use client";

import { useRef, useState } from "react";
import { RankedStream } from "@/components/redesign/swiss/RankedStream";
import type { FeedItem, Story } from "@/types/story";

// DEV-ONLY visual preview for redesign-v2 build #1 (content-type-aware feed
// cards + THE CONNECTION hero). Self-contained mock data so the card-type
// system can be rendered and screenshotted WITHOUT the backend / auth stack
// (campus Wi-Fi blocks Postgres 5432). Not linked from nav; not a product
// surface. Delete or keep behind a dev flag before any launch cut.

function mock(overrides: Partial<Story>): Story {
  return {
    id: Math.random().toString(36).slice(2),
    sector: "ai",
    headline: "Source headline",
    context: "",
    why_it_matters: "",
    gated: false,
    kind: "ingested",
    why_it_matters_to_you: "",
    commentary: null,
    commentary_source: null,
    generic_commentary: null,
    generator_type: null,
    source_url: "https://example.com",
    source_name: "Reuters",
    primary_source_url: "https://example.com",
    sources: [{ url: "https://example.com", name: "Reuters", role: "primary" }],
    image_url: null,
    illustration_url: null,
    published_at: "2026-06-06T09:00:00Z",
    created_at: "2026-06-06T09:00:00Z",
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
    reading_time_minutes: 4,
    ...overrides,
  };
}

const STORIES: Story[] = [
  mock({
    sector: "finance",
    kind: "native",
    generator_type: "cross-sector-chain-native",
    headline: "The Sovereign AI Capex Loop: How State-Backed Capital is Re-shoring 2nm Silicon",
    generic_commentary:
      "Sovereign wealth funds are shifting from passive equity investors to active infrastructure co-developers. This fragments global chip capacity but guarantees the capital to lock in ASML High-NA EUV backlogs through the 2027 hyperscaler refresh cycle.",
    sources: [
      { url: "a", name: "Bloomberg", role: "primary" },
      { url: "b", name: "SemiAnalysis", role: "alternate" },
      { url: "c", name: "Reuters", role: "alternate" },
    ],
    reading_time_minutes: 7,
  }),
  mock({
    sector: "ai",
    kind: "native",
    generator_type: "arxiv-synthesis-native",
    headline: "Decentralized Mixture of Experts (MoE) Routing Over Commodity Fiber Networks",
    generic_commentary:
      "By eliminating the InfiniBand/NVLink dependency for multi-node MoE inference, this protocol shifts the competitive advantage away from hyper-centralized cloud clusters toward distributed compute providers. The latency masking is the whole game.",
    image_url:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
    reading_time_minutes: 6,
  }),
  mock({
    sector: "ai",
    kind: "native",
    generator_type: "hn-synthesis-native",
    headline: "The Developer's Dilemma: Why Small, Fine-Tuned Models Are Outperforming GPT-4o",
    generic_commentary:
      "The economic reality of production AI is killing the 'one model to rule them all' narrative. Startups are building proprietary moats around specialized, fine-tuned models on curated domain datasets.",
    comment_count: 156,
    reading_time_minutes: 5,
  }),
  mock({
    sector: "semiconductors",
    kind: "ingested",
    headline: "Nvidia Q2 margins compress as Blackwell packaging yields lag",
    generic_commentary:
      "Nvidia's gross margin contraction confirms advanced packaging (TSMC's CoWoS-L) is the primary physical bottleneck of the AI boom. The one number that mattered was the 8-point sequential GM drop.",
    sources: [
      { url: "a", name: "Bloomberg", role: "primary" },
      { url: "b", name: "CNBC", role: "alternate" },
      { url: "c", name: "Reuters", role: "alternate" },
      { url: "d", name: "WSJ", role: "alternate" },
      { url: "e", name: "FT", role: "alternate" },
    ],
    reading_time_minutes: 3,
  }),
  mock({
    sector: "ai",
    kind: "native",
    generator_type: "tool-spotlight-native",
    headline: "OpenAI's Triton 3.0: Breaking Nvidia's CUDA Monopolization with Native AMD Support",
    generic_commentary:
      "Triton 3.0 is the most credible threat to Nvidia's software moat. By compiling Python directly to non-Nvidia hardware with zero performance loss, it makes the hardware fungible.",
    reading_time_minutes: 8,
  }),
  mock({
    sector: "finance",
    kind: "ingested",
    headline: "Fed holds rates, signals one cut before year-end",
    generic_commentary:
      "The hold keeps the cost of capital elevated for another quarter, which directly pressures the leveraged buildout math for every sub-scale AI infrastructure player.",
    source_name: "Reuters",
    reading_time_minutes: 2,
  }),
];

export default function RedesignPreviewPage(): JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(STORIES[1]?.id ?? null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const items: FeedItem[] = STORIES.map((s) => ({ ...s, gated: false }));

  return (
    <div className="theme-swiss min-h-dvh bg-bg text-ink">
      <div className="mx-auto flex w-full max-w-[1840px] flex-col px-4 md:px-12 lg:px-20">
        <header className="border-b-2 border-line py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            Daily Intelligence Briefing · Redesign v2 Preview (mock data)
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold">SIGNAL</h1>
        </header>
        <div className="flex flex-col lg:flex-row">
          <div className="min-w-0 flex-1 lg:flex-[1.5] lg:border-r lg:border-line">
            <RankedStream
              items={items}
              activeId={activeId}
              onSelect={setActiveId}
              sectors={[]}
              onSectorsChange={() => undefined}
              sentinelRef={sentinelRef}
              isFetchingNextPage={false}
              hasNextPage={false}
            />
          </div>
          <aside className="hidden w-[360px] flex-none p-8 lg:block">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
              The Through-Line //
            </p>
            <p className="mt-3 font-serif text-[15px] italic leading-relaxed text-ink">
              &ldquo;Today&rsquo;s macro picture connects sovereign wealth directly
              to 2nm yields, triggering a software decentralization loop that
              commoditizes NVLink/CUDA.&rdquo;
            </p>
            <div className="mt-6 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
              Detail reader renders here on select
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
