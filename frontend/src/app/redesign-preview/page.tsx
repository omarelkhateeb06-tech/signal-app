"use client";

import { useRef, useState } from "react";
import { RankedStream } from "@/components/redesign/swiss/RankedStream";
import { ConnectionHero } from "@/components/redesign/swiss/ConnectionHero";
import { StoryExhibit } from "@/components/redesign/swiss/StoryExhibit";
import { isConnectionStory } from "@/lib/feedCardType";
import type { FeedItem, Story } from "@/types/story";

// DEV-ONLY visual preview for redesign-v2 (content-type-aware feed cards, THE
// CONNECTION hero, row thumbnails, second-peak feature, freshness badges, and
// the locked personalized-read teaser). Self-contained mock data so the card
// system renders WITHOUT the backend / auth stack (campus Wi-Fi blocks
// Postgres 5432). Not linked from nav; not a product surface.

// Inline SVG art so images render in the sandbox (external hosts are blocked).
const svg = (raw: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;

// Deterministic node positions (no Math.random — keeps SSR/CSR markup equal).
const NODES = [
  [40, 60],
  [120, 40],
  [200, 90],
  [280, 50],
  [340, 120],
  [80, 160],
  [160, 200],
  [240, 150],
  [320, 190],
  [60, 110],
];
const SCHOLARLY = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><rect width='400' height='240' fill='#1a1714'/><g stroke='#8B4513' stroke-width='1' opacity='0.5'>${Array.from(
    { length: 9 },
    (_, i) => `<line x1='${i * 50}' y1='0' x2='${i * 50}' y2='240'/>`,
  ).join("")}${Array.from(
    { length: 6 },
    (_, i) => `<line x1='0' y1='${i * 48}' x2='400' y2='${i * 48}'/>`,
  ).join(
    "",
  )}</g><g fill='#d9c4a9'>${NODES.map(([x, y]) => `<circle cx='${x}' cy='${y}' r='2.5'/>`).join("")}</g></svg>`,
);

const DATA = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><rect width='400' height='240' fill='#17140f'/><g fill='#8B4513'>${[
    120, 80, 160, 60, 180, 100, 140,
  ]
    .map((h, i) => `<rect x='${20 + i * 52}' y='${220 - h}' width='34' height='${h}'/>`)
    .join("")}</g><line x1='0' y1='220' x2='400' y2='220' stroke='#d9c4a9' stroke-width='1.5'/></svg>`,
);

const now = "2026-06-06T11:30:00Z"; // recent → NEW badges
const old = "2026-06-03T09:00:00Z";

function mock(overrides: Partial<Story>): Story {
  return {
    id: "mock",
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
    content_type: null,
    published_at: old,
    created_at: old,
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
    published_at: now,
    created_at: now,
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
    published_at: now,
    created_at: now,
    image_url: SCHOLARLY,
    headline: "Decentralized Mixture of Experts (MoE) Routing Over Commodity Fiber Networks",
    generic_commentary:
      "By eliminating the InfiniBand/NVLink dependency for multi-node MoE inference, this protocol shifts the competitive advantage away from hyper-centralized cloud clusters toward distributed compute providers. The latency masking is the whole game.",
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
    content_type: "filing",
    published_at: now,
    created_at: now,
    headline: "Nvidia Q2 10-Q: gross margin compresses as Blackwell packaging yields lag",
    generic_commentary:
      "Nvidia's gross margin contracted 8% to a still-elite 67% as advanced packaging (TSMC's CoWoS-L) became the AI boom's primary physical bottleneck.",
    why_it_matters_to_you:
      "As a semiconductor VC, this is your signal to re-underwrite every CoWoS-adjacent packaging startup in your pipeline — the bottleneck just became investable.",
    sources: [
      { url: "a", name: "SEC EDGAR", role: "primary" },
      { url: "b", name: "Bloomberg", role: "alternate" },
      { url: "c", name: "CNBC", role: "alternate" },
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
    image_url: DATA,
    published_at: now,
    created_at: now,
    headline: "Fed holds rates, signals one cut before year-end as inflation cools",
    generic_commentary:
      "The hold keeps the cost of capital elevated for another quarter, which directly pressures the leveraged buildout math for every sub-scale AI infrastructure player.",
    why_it_matters_to_you:
      "Your portfolio's bridge-round timing math just shifted — a Q4 cut means the cheap-capital window you've been waiting on slips into 2027.",
    sources: [
      { url: "a", name: "Reuters", role: "primary" },
      { url: "b", name: "Bloomberg", role: "alternate" },
      { url: "c", name: "WSJ", role: "alternate" },
    ],
    reading_time_minutes: 4,
  }),
  mock({
    sector: "semiconductors",
    kind: "ingested",
    headline: "TSMC Arizona fab hits volume production on N4 node",
    generic_commentary:
      "The first high-volume US leading-edge output de-risks the supply chain that every American AI hyperscaler depends on.",
    why_it_matters_to_you:
      "For a semiconductor VC, domestic N4 volume resets the geographic-risk discount you apply to every fabless cap-table in the US.",
    reading_time_minutes: 3,
  }),
  mock({
    sector: "ai",
    kind: "ingested",
    content_type: "launch",
    source_name: "Product Hunt",
    sources: [{ url: "https://producthunt.com", name: "Product Hunt", role: "primary" }],
    published_at: now,
    created_at: now,
    headline: "Cascade — drop-in KV-cache offload that halves inference memory",
    generic_commentary:
      "A new open-source library streams attention KV-cache to NVMe so you can run longer-context models on the GPU you already have. The 'why now': context windows outgrew VRAM faster than VRAM got cheap.",
    why_it_matters_to_you:
      "As a semiconductor VC, this is a software end-run around the HBM shortage — worth a look before you re-underwrite a memory-bound thesis.",
    reading_time_minutes: 2,
  }),
];

// Native editorial mocks for the upgraded SIGNAL ORIGINALS band preview.
const ORIGINALS: Story[] = [
  mock({
    sector: "finance",
    kind: "native",
    generator_type: "cross-sector-chain-native",
    published_at: now,
    created_at: now,
    illustration_url: DATA,
    headline: "Memory Shortage Premium Meets Rate Expectations — SK Hynix Bet Now Hinges on Central Bank Action",
    generic_commentary:
      "The HBM supply squeeze and the Fed's rate path have quietly fused into one trade. If cuts slip, the leveraged memory-capex bets that the AI buildout depends on get repriced — and SK Hynix sits at the exact intersection.",
    reading_time_minutes: 6,
  }),
  mock({
    sector: "ai",
    kind: "native",
    generator_type: "arxiv-synthesis-native",
    published_at: now,
    created_at: now,
    illustration_url: SCHOLARLY,
    headline: "Efficient adaptation is becoming the path to scaling constrained systems",
    generic_commentary:
      "Three papers this month converge on the same finding: parameter-efficient adaptation now matches full fine-tuning on narrow tasks at a fraction of the compute, shifting the moat from raw scale to data curation.",
    reading_time_minutes: 5,
  }),
  mock({
    sector: "semiconductors",
    kind: "native",
    generator_type: "hn-synthesis-native",
    headline: "The AI chip shortage is forcing a choice between local inference and upgradeable hardware",
    generic_commentary:
      "Practitioners are splitting into two camps — those buying fixed-function inference boxes now, and those betting on modular upgrade paths. The thread consensus: the upgrade path wins unless your latency budget is brutal.",
    comment_count: 92,
    reading_time_minutes: 4,
  }),
];

function OriginalsBand(): JSX.Element {
  const heroIdx = ORIGINALS.findIndex((s) => isConnectionStory(s));
  const hero = heroIdx >= 0 ? ORIGINALS[heroIdx] : null;
  return (
    <section className="border-b border-line bg-accent/[0.03] px-6 py-6 md:px-8">
      <div className="mb-4 flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 flex-none bg-accent" />
        <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-ink">
          Signal Originals
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          written by SIGNAL
        </span>
      </div>
      {hero && (
        <ConnectionHero
          story={hero}
          rank={1}
          isActive={false}
          onSelect={() => undefined}
        />
      )}
      <div>
        {ORIGINALS.map((s, i) =>
          i === heroIdx ? null : (
            <StoryExhibit
              key={s.id}
              story={{ ...s, id: `orig-${i}` }}
              rank={i + 1}
              isActive={false}
              onSelect={() => undefined}
              freshSinceMs={Date.parse("2026-06-06T00:00:00Z")}
            />
          ),
        )}
      </div>
    </section>
  );
}

export default function RedesignPreviewPage(): JSX.Element {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const items: FeedItem[] = STORIES.map((s, i) => ({
    ...s,
    id: `mock-${i}`,
    gated: false,
  }));
  const [activeId, setActiveId] = useState<string | null>("mock-1");

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
            <OriginalsBand />
            <RankedStream
              items={items}
              activeId={activeId}
              onSelect={setActiveId}
              sectors={[]}
              onSectorsChange={() => undefined}
              sentinelRef={sentinelRef}
              isFetchingNextPage={false}
              hasNextPage={false}
              roleLabel="Semiconductor VC"
              showTeaser
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
