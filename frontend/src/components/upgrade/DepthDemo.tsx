"use client";

import { useState } from "react";
import { motion } from "framer-motion";

// Phase 12x — the offer page's single most convincing asset: the depth
// toggle, demonstrated. Same story, re-rendered at all three depths so a
// prospect SEES what "Accessible · Briefed · Technical" actually means
// (the feature that justifies Pro) instead of reading three bare words on
// a locked control inside the app.

type Depth = "accessible" | "briefed" | "technical";

const DEPTHS: ReadonlyArray<{ value: Depth; label: string; blurb: string }> = [
  {
    value: "accessible",
    label: "Accessible",
    blurb: "Plain-English. No jargon. The point, fast.",
  },
  {
    value: "briefed",
    label: "Briefed",
    blurb: "For a working professional in an adjacent field.",
  },
  {
    value: "technical",
    label: "Technical",
    blurb: "Insider depth — assumes the vocabulary.",
  },
];

const SAMPLE_HEADLINE = "TSMC lifts 2026 capex to $52B on AI-accelerator demand";

const COMMENTARY: Record<Depth, string> = {
  accessible:
    "TSMC is spending a record $52B next year, almost all of it on its most advanced chips and the packaging that stitches AI processors together. The takeaway: demand for AI hardware is real enough that the world's most important chipmaker is betting billions it keeps growing through 2027.",
  briefed:
    "The raise skews almost entirely to leading-edge (N2/A16) and advanced packaging — not mature nodes. That widens TSMC's lead on advanced capacity and signals where hyperscaler accelerator orders are actually landing. The number to watch is CoWoS packaging: it's the current bottleneck on AI-accelerator supply.",
  technical:
    "Capex is concentrated in the N2/A16 ramp and CoWoS-L / SoIC capacity, not trailing nodes — a read-through that 2026–27 accelerator TAM is being underwritten at the substrate layer. CoWoS stays the binding constraint; the allocation implies TSMC expects packaging, not wafer starts, to gate hyperscaler shipments, and is pricing advanced-packaging scarcity into its moat.",
};

const SEGMENT_PCT = 100 / DEPTHS.length;

export function DepthDemo(): JSX.Element {
  const [depth, setDepth] = useState<Depth>("accessible");
  const activeIndex = Math.max(0, DEPTHS.findIndex((d) => d.value === depth));
  const active = DEPTHS[activeIndex];

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setDepth(DEPTHS[(activeIndex + 1) % DEPTHS.length].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setDepth(DEPTHS[(activeIndex - 1 + DEPTHS.length) % DEPTHS.length].value);
    }
  };

  return (
    <section className="space-y-3">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          See exactly what Pro reads for you
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          One story, three depths — slide to your level.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Commentary depth"
        onKeyDown={onKeyDown}
        className="relative mx-auto flex w-full max-w-[420px] items-stretch rounded-md border border-line bg-bg p-1"
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1 top-1 bottom-1 rounded-[6px] bg-surface shadow-card"
          style={{ width: `calc(${SEGMENT_PCT}% - 4px)` }}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
        />
        {DEPTHS.map((d) => (
          <button
            key={d.value}
            type="button"
            role="tab"
            id={`depth-tab-${d.value}`}
            aria-selected={d.value === depth}
            aria-controls="depth-demo-panel"
            tabIndex={d.value === depth ? 0 : -1}
            onClick={() => setDepth(d.value)}
            className={[
              "relative z-10 flex flex-1 items-center justify-center",
              "rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              d.value === depth ? "text-ink" : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {d.label}
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-ink-muted">{active.blurb}</p>

      <div
        role="tabpanel"
        id="depth-demo-panel"
        aria-labelledby={`depth-tab-${depth}`}
        className="rounded-lg border border-t-2 border-line border-t-sector-semis bg-surface p-5"
      >
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-semis">
          Semiconductors · TSMC
        </span>
        <h3 className="mt-2 font-display text-[19px] font-bold leading-snug text-ink">
          {SAMPLE_HEADLINE}
        </h3>
        <div className="mt-3 min-h-[7.5rem]">
          <motion.p
            key={depth}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="text-[14px] leading-[1.7] text-ink-muted"
          >
            {COMMENTARY[depth]}
          </motion.p>
        </div>
        <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-muted">
          Sample — in the app, every story is written for your role, seniority,
          and the sectors you follow.
        </p>
      </div>
    </section>
  );
}
