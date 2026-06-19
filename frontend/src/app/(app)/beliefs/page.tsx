"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  useBeliefChallenges,
  useBeliefMutations,
  useBeliefs,
} from "@/hooks/useBeliefs";
import {
  extractApiError,
  type Belief,
  type BeliefChallenge,
  type BeliefRelevance,
  type ChallengeResponse,
} from "@/lib/api";

// Belief maintenance — the missionary pivot's primary surface. The reader
// records working assumptions; each week SIGNAL flags the one development
// that should make them reconsider. The unit of value is a belief revised.

const SECTORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "General" },
  { value: "ai", label: "AI" },
  { value: "finance", label: "Finance" },
  { value: "semiconductors", label: "Semiconductors" },
];

const MIN_LEN = 8;
const MAX_LEN = 280;

const PRIMARY_BTN =
  "inline-flex items-center justify-center border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BTN =
  "inline-flex items-center justify-center border border-line px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50";

// How each relevance class is presented. `rank` orders the radar loud-first.
// Tailwind needs literal class names, so border/text are spelled out (no
// dynamic `text-${tone}`). All four tones map to real theme tokens.
interface RelevanceMeta {
  rank: number;
  eyebrow: string;
  badge: string;
  border: string;
  text: string;
  dissentLabel: string;
}
const RELEVANCE_META: Record<BeliefRelevance, RelevanceMeta> = {
  contradicts: {
    rank: 0,
    eyebrow: "Reconsider",
    badge: "Contradicts",
    border: "border-err",
    text: "text-err",
    dissentLabel: "The case it still holds",
  },
  pressures: {
    rank: 1,
    eyebrow: "Under pressure",
    badge: "Pressures",
    border: "border-warn",
    text: "text-warn",
    dissentLabel: "The case it still holds",
  },
  supports: {
    rank: 2,
    eyebrow: "Holding up",
    badge: "Supports",
    border: "border-ok",
    text: "text-ok",
    dissentLabel: "The caveat",
  },
  watch: {
    rank: 3,
    eyebrow: "On the radar",
    badge: "Watch",
    border: "border-accent",
    text: "text-accent",
    dissentLabel: "Why it isn't decisive yet",
  },
};
// Defensive: a pre-hybrid or unexpected value falls back to the calmest tone.
function metaFor(relevance: BeliefRelevance | undefined): RelevanceMeta {
  return RELEVANCE_META[relevance as BeliefRelevance] ?? RELEVANCE_META.watch;
}
const isLoud = (r: BeliefRelevance): boolean =>
  r === "contradicts" || r === "pressures";

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
      {children}
    </h2>
  );
}

function ChallengeCard({
  challenge,
  onRespond,
  pending,
}: {
  challenge: BeliefChallenge;
  onRespond: (r: ChallengeResponse) => void;
  pending: boolean;
}): JSX.Element {
  const responded = challenge.response != null;
  const meta = metaFor(challenge.relevance);
  return (
    <article className="border border-ink/80 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            You believed
          </p>
          <p className="mt-1.5 font-serif text-[19px] leading-snug text-ink">
            {challenge.statement}
          </p>
        </div>
        <span
          className={`flex-none border ${meta.border} ${meta.text} px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em]`}
        >
          {meta.badge}
        </span>
      </div>

      <div className={`mt-4 border-l-[3px] py-3 pl-4 pr-3 ${meta.border}`}>
        <p
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${meta.text}`}
        >
          {meta.eyebrow}
        </p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink">
          {challenge.how_to_update}
        </p>
      </div>

      {challenge.dissent && (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
            {meta.dissentLabel}
          </p>
          <p className="mt-1 max-w-[64ch] font-serif text-[14px] italic leading-relaxed text-ink-muted">
            {challenge.dissent}
          </p>
        </div>
      )}

      {challenge.source_headline && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          Triggered by ·{" "}
          <span className="normal-case text-ink">{challenge.source_headline}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {responded ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            {challenge.response === "revised"
              ? "✓ You revised this"
              : challenge.response === "held"
                ? "You held your view"
                : "Dismissed"}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onRespond("revised")}
              disabled={pending}
              className={PRIMARY_BTN}
            >
              I revised this
            </button>
            <button
              type="button"
              onClick={() => onRespond("held")}
              disabled={pending}
              className={GHOST_BTN}
            >
              I&apos;m holding
            </button>
            <button
              type="button"
              onClick={() => onRespond("dismissed")}
              disabled={pending}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function BeliefRow({
  belief,
  muted,
  onDelete,
}: {
  belief: Belief;
  muted?: boolean;
  onDelete: () => void;
}): JSX.Element {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p
          className={`text-[15px] leading-snug ${muted ? "text-ink-muted line-through" : "text-ink"}`}
        >
          {belief.statement}
        </p>
        <p className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          {belief.sector ? <span>{belief.sector}</span> : <span>general</span>}
          {muted && <span className="text-accent">· revised</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove belief"
        className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-err"
      >
        Remove
      </button>
    </li>
  );
}

export default function BeliefsPage(): JSX.Element {
  const beliefsQuery = useBeliefs();
  const challengesQuery = useBeliefChallenges();
  const { create, remove, run, respond } = useBeliefMutations();
  const [statement, setStatement] = useState("");
  const [sector, setSector] = useState("");

  const beliefs = beliefsQuery.data ?? [];
  const active = beliefs.filter((b) => b.status === "active");
  const revised = beliefs.filter((b) => b.status === "revised");
  const challenges = challengesQuery.data?.challenges ?? [];
  const sortedChallenges = [...challenges].sort(
    (a, b) => metaFor(a.relevance).rank - metaFor(b.relevance).rank,
  );
  const loudCount = challenges.filter((c) => isLoud(c.relevance)).length;
  const hasRun = run.isSuccess || challenges.length > 0;

  const trimmed = statement.trim();
  const canAdd = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  const handleAdd = (e: FormEvent): void => {
    e.preventDefault();
    if (!canAdd) return;
    create.mutate(
      { statement: trimmed, sector: sector || null },
      {
        onSuccess: () => {
          setStatement("");
          setSector("");
        },
      },
    );
  };

  // A manual run always forces (force=true): an explicit click means "show me
  // this week's read now". A non-forced run would skip any belief already marked
  // checked this week — a prior empty/Haiku-failed run, or the pre-hybrid clean
  // run — and leave the reader dead-ended on an empty state. The 0067 cost guard
  // still protects any future automated pre-generation path.
  const handleRunCheck = (): void => {
    run.mutate(true);
  };

  return (
    <div className="theme-swiss min-h-[calc(100dvh-3.5rem)] bg-bg text-ink">
      <div className="mx-auto max-w-[860px] px-4 py-8 md:px-8">
        <header className="border-b-2 border-ink pb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Belief maintenance
          </p>
          <h1 className="mt-1 font-display text-[34px] font-black leading-none tracking-tight md:text-[42px]">
            Your Beliefs
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-muted">
            The working assumptions you&apos;re betting on. Each week SIGNAL
            checks them against what actually happened — and names where this
            week&apos;s developments push on them, hardest first.
          </p>
        </header>

        {/* Reconsider ritual */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>This week — Reconsider</SectionLabel>
            {active.length > 0 && (
              <button
                type="button"
                onClick={handleRunCheck}
                disabled={run.isPending}
                className={GHOST_BTN}
              >
                {run.isPending
                  ? "Checking…"
                  : hasRun
                    ? "Re-check"
                    : "Run this week's check"}
              </button>
            )}
          </div>

          <div className="mt-4">
            {active.length === 0 ? (
              <p className="text-[15px] leading-relaxed text-ink-muted">
                Add a belief below, then run the check.
              </p>
            ) : run.isPending ? (
              <p className="text-[15px] leading-relaxed text-ink-muted">
                Checking your beliefs against this week&apos;s developments…
              </p>
            ) : sortedChallenges.length > 0 ? (
              <div className="space-y-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                  {loudCount > 0
                    ? `${loudCount} development${loudCount === 1 ? "" : "s"} pushing on your beliefs this week`
                    : "Quiet week — nothing's contradicting you, but here's what's adjacent"}
                </p>
                {sortedChallenges.map((c) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    pending={respond.isPending}
                    onRespond={(r) => respond.mutate({ id: c.id, response: r })}
                  />
                ))}
              </div>
            ) : hasRun ? (
              <p className="text-[15px] leading-relaxed text-ink-muted">
                Nothing relevant surfaced this week — not even adjacent. Re-check
                later as new developments land.
              </p>
            ) : (
              <p className="text-[15px] leading-relaxed text-ink-muted">
                Run the check to see whether this week&apos;s developments
                challenge anything you believe.
              </p>
            )}
            {run.isError && (
              <p className="mt-2 text-sm text-err">{extractApiError(run.error)}</p>
            )}
          </div>
        </section>

        {/* Add a belief */}
        <section className="mt-10">
          <SectionLabel>Add a belief</SectionLabel>
          <form onSubmit={handleAdd} className="mt-3 space-y-3">
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={MAX_LEN}
              rows={2}
              placeholder="e.g. Transformer scaling keeps winning through 2027"
              className="w-full resize-none border border-line bg-surface px-3 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="border border-line bg-surface px-3 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-ink focus:border-accent focus:outline-none"
              >
                {SECTORS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!canAdd || create.isPending}
                className={PRIMARY_BTN}
              >
                {create.isPending ? "Adding…" : "Add belief"}
              </button>
              <span className="font-mono text-[10px] text-ink-muted">
                {trimmed.length}/{MAX_LEN}
              </span>
            </div>
            {create.isError && (
              <p className="text-sm text-err">{extractApiError(create.error)}</p>
            )}
          </form>
        </section>

        {/* Tracked beliefs */}
        <section className="mt-10 pb-12">
          <SectionLabel>Tracked beliefs</SectionLabel>
          {active.length === 0 && revised.length === 0 ? (
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              No beliefs yet — your first one goes above.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {active.map((b) => (
                <BeliefRow key={b.id} belief={b} onDelete={() => remove.mutate(b.id)} />
              ))}
              {revised.map((b) => (
                <BeliefRow
                  key={b.id}
                  belief={b}
                  muted
                  onDelete={() => remove.mutate(b.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
