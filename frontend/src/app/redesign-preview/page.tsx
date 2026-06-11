"use client";

import { useRef, useState } from "react";
import { notFound } from "next/navigation";
import { RankedStream } from "@/components/redesign/swiss/RankedStream";
import { storyTitleAndBrief } from "@/components/redesign/swiss/swissView";
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

// (a) Image-first detail reader — mirrors the real DetailPanel's new layout:
// the image bursts at the top, then the depth control, kicker, headline, and
// the structured read. Renders no image when the story has none (honest).
function DetailMock({ story }: { story: Story | null }): JSX.Element {
  if (!story) {
    return (
      <div className="p-8 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
        Select a story
      </div>
    );
  }
  const art = story.image_url ?? story.illustration_url ?? null;
  const { title, brief } = storyTitleAndBrief(story);
  const why = story.why_it_matters_to_you?.trim() || brief;
  return (
    <div className="space-y-6 px-6 py-6 md:px-8">
      {art && (
        <div className="-mx-6 h-[210px] overflow-hidden bg-ink md:-mx-8 md:h-[270px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink">
          Intel Depth:
        </span>
        {["Accessible", "Briefed", "Technical"].map((d, i) => (
          <span
            key={d}
            className={`font-mono text-[10px] uppercase tracking-[0.14em] ${i === 1 ? "bg-accent px-2 py-0.5 text-bg" : "text-ink-muted"}`}
          >
            {d}
          </span>
        ))}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
        {story.sector}
      </div>
      <h2 className="font-display text-[28px] font-bold leading-[1.08] tracking-tight md:text-[32px]">
        {title}
      </h2>
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          The Core Brief //
        </p>
        <p className="mt-2 text-[15px] leading-[1.85] text-ink">{brief}</p>
      </div>
      <div className="border-l-[3px] border-accent bg-accent/[0.06] py-3 pl-4 pr-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Why It Matters //
        </p>
        <p className="mt-2 font-serif text-[15px] italic leading-[1.8] text-ink">
          {why}
        </p>
      </div>
    </div>
  );
}

// (b) Lead with ONE Connection hero, then news with the other Originals
// interleaved among it (not a 6-wide band at the top).
const NATIVE_ORIGINALS = ORIGINALS.filter((s) => !isConnectionStory(s));
function interleavedItems(): FeedItem[] {
  const merged: Story[] = [];
  let ni = 0;
  STORIES.forEach((s, i) => {
    merged.push(s);
    if ((i + 1) % 3 === 0 && ni < NATIVE_ORIGINALS.length) {
      merged.push(NATIVE_ORIGINALS[ni++]);
    }
  });
  merged.push(...NATIVE_ORIGINALS.slice(ni));
  return merged.map((s, i) => ({ ...s, id: `mock-${i}`, gated: false }));
}

export default function RedesignPreviewPage(): JSX.Element {
  // Dev-only surface — hard-404 in production builds (ROADMAP §14 carried
  // item). NODE_ENV is inlined at build time, so the prod bundle gates
  // unconditionally while local dev keeps the preview.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const sentinelRef = useRef<HTMLDivElement>(null);
  const items: FeedItem[] = interleavedItems();
  const [activeId, setActiveId] = useState<string | null>("mock-1");
  const activeStory =
    (items.find((i) => i.id === activeId) as Story | undefined) ?? null;

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
              roleLabel="Semiconductor VC"
              showTeaser
            />
          </div>
          <aside className="hidden w-[400px] flex-none lg:block">
            <DetailMock story={activeStory} />
          </aside>
        </div>
      </div>
    </div>
  );
}
