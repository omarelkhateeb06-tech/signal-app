"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  useBeliefChallenges,
  useBeliefEvolution,
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

// Belief Evolution (partial B) — the reskin from "alerts when you're wrong" to
// "watch how your thinking evolves." You declare what you believe; as new
// developments land, the matcher surfaces what STRENGTHENS and what CHALLENGES
// each belief — both, neutrally — and you log how your view moved, in your own
// words. The headline artifact is the per-belief evolution timeline. (Route +
// belief_* internals unchanged; only the language and shape the reader sees.)

const SECTORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "General" },
  { value: "ai", label: "AI" },
  { value: "finance", label: "Finance" },
  { value: "semiconductors", label: "Semiconductors" },
];

// Mirror the backend limits.
const MIN_LEN = 8;
const MAX_LEN = 280;
const MAX_HORIZON = 80;
const MAX_BREAKER = 280;
const MAX_NOTE = 1000;
const CONVICTIONS = [1, 2, 3, 4, 5] as const;

const PRIMARY_BTN =
  "inline-flex items-center justify-center border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BTN =
  "inline-flex items-center justify-center border border-line px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50";

// How a development moves a belief — framed as evolution, not alarm. Literal
// class names (Tailwind can't see dynamic ones); all map to theme tokens.
interface MovementMeta {
  rank: number;
  eyebrow: string;
  badge: string;
  border: string;
  text: string;
  dissentLabel: string;
}
const MOVEMENT_META: Record<BeliefRelevance, MovementMeta> = {
  supports: {
    rank: 0,
    eyebrow: "Strengthens this",
    badge: "Strengthens",
    border: "border-ok",
    text: "text-ok",
    dissentLabel: "The caveat",
  },
  contradicts: {
    rank: 1,
    eyebrow: "Challenges this",
    badge: "Challenges",
    border: "border-err",
    text: "text-err",
    dissentLabel: "The case it still holds",
  },
  pressures: {
    rank: 2,
    eyebrow: "Tests this",
    badge: "Tests",
    border: "border-warn",
    text: "text-warn",
    dissentLabel: "The case it still holds",
  },
  watch: {
    rank: 3,
    eyebrow: "Worth watching",
    badge: "Adjacent",
    border: "border-accent",
    text: "text-accent",
    dissentLabel: "Why it isn't decisive yet",
  },
};
function movementFor(relevance: BeliefRelevance | undefined): MovementMeta {
  return MOVEMENT_META[relevance as BeliefRelevance] ?? MOVEMENT_META.watch;
}

// Response options, in growth language. (Maps to the stored enum.)
const RESPONSES: ReadonlyArray<{ value: ChallengeResponse; label: string }> = [
  { value: "revised", label: "Changed my view" },
  { value: "strengthened", label: "Strengthened it" },
  { value: "held", label: "Unchanged" },
];
function responseLabel(r: ChallengeResponse): string {
  switch (r) {
    case "revised":
      return "Changed my view";
    case "strengthened":
      return "Strengthened it";
    case "held":
      return "Unchanged";
    default:
      return "Dismissed";
  }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
      {children}
    </h2>
  );
}

function ConvictionMeter({ value }: { value: number }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      aria-label={`Conviction ${value} of 5`}
    >
      {CONVICTIONS.map((n) => (
        <span
          key={n}
          aria-hidden
          className={
            n <= value ? "h-2 w-2 bg-accent" : "h-2 w-2 border border-line"
          }
        />
      ))}
    </span>
  );
}

// One development that moved a belief — what it means + the honest counter-case,
// with a place to record how your thinking actually moved.
function EvidenceCard({
  challenge,
  onRespond,
  pending,
}: {
  challenge: BeliefChallenge;
  onRespond: (response: ChallengeResponse, note: string) => void;
  pending: boolean;
}): JSX.Element {
  const [note, setNote] = useState("");
  const meta = movementFor(challenge.relevance);
  const responded = challenge.response != null;
  return (
    <article className="border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${meta.text}`}
        >
          {meta.eyebrow}
        </p>
        <span
          className={`flex-none border ${meta.border} ${meta.text} px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em]`}
        >
          {meta.badge}
        </span>
      </div>

      {challenge.source_headline && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          From · <span className="normal-case text-ink">{challenge.source_headline}</span>
        </p>
      )}

      <p className="mt-2 text-[15px] leading-relaxed text-ink">
        {challenge.how_to_update}
      </p>

      {challenge.dissent && (
        <p className="mt-2 max-w-[64ch] font-serif text-[13px] italic leading-relaxed text-ink-muted">
          <span className="font-mono text-[10px] not-italic uppercase tracking-[0.14em]">
            {meta.dissentLabel} ·{" "}
          </span>
          {challenge.dissent}
        </p>
      )}

      <div className="mt-3 border-t border-line pt-3">
        {responded ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            You: {responseLabel(challenge.response as ChallengeResponse)}
            {challenge.response_note ? (
              <span className="normal-case text-ink"> — “{challenge.response_note}”</span>
            ) : null}
          </p>
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_NOTE}
              rows={2}
              placeholder="How did this move your thinking? (optional)"
              className="w-full resize-none border border-line bg-bg px-3 py-2 text-[14px] leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {RESPONSES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => onRespond(r.value, note)}
                  disabled={pending}
                  className={r.value === "revised" ? PRIMARY_BTN : GHOST_BTN}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onRespond("dismissed", note)}
                disabled={pending}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                Not relevant
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

// The full history of what's moved a belief over time (lazy — only when opened).
function EvolutionTimeline({ beliefId }: { beliefId: string }): JSX.Element {
  const { data, isPending, isError } = useBeliefEvolution(beliefId);
  if (isPending) {
    return (
      <p className="mt-3 text-[13px] text-ink-muted">Loading the timeline…</p>
    );
  }
  if (isError || !data) {
    return (
      <p className="mt-3 text-[13px] text-err">Couldn&apos;t load the timeline.</p>
    );
  }
  if (data.evolution.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-ink-muted">
        Nothing has moved this belief yet — it&apos;s being watched.
      </p>
    );
  }
  return (
    <ol className="mt-3 space-y-3 border-l border-line pl-4">
      {data.evolution.map((e) => {
        const meta = movementFor(e.relevance);
        return (
          <li key={e.id} className="relative">
            <span
              aria-hidden
              className={`absolute -left-[1.30rem] top-1.5 h-2 w-2 rounded-full ${meta.border} border bg-bg`}
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
              <span className={meta.text}>{meta.badge}</span>
              {e.created_at ? ` · ${shortDate(e.created_at)}` : ""}
            </p>
            {e.source_headline && (
              <p className="mt-0.5 text-[13px] text-ink">{e.source_headline}</p>
            )}
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
              {e.how_to_update}
            </p>
            {e.response && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                You: {responseLabel(e.response)}
                {e.response_note ? (
                  <span className="normal-case text-ink-muted"> — “{e.response_note}”</span>
                ) : null}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function movementSummary(evidence: ReadonlyArray<BeliefChallenge>): string {
  const strengthens = evidence.filter((c) => c.relevance === "supports").length;
  const challenges = evidence.filter(
    (c) => c.relevance === "contradicts" || c.relevance === "pressures",
  ).length;
  const parts: string[] = [];
  if (strengthens > 0) parts.push(`${strengthens} strengthened it`);
  if (challenges > 0) parts.push(`${challenges} challenged it`);
  if (parts.length === 0) return "Adjacent developments worth a look";
  return `This week: ${parts.join(", ")}`;
}

function BeliefCard({
  belief,
  evidence,
  onRespond,
  onDelete,
  pending,
}: {
  belief: Belief;
  evidence: ReadonlyArray<BeliefChallenge>;
  onRespond: (id: string, response: ChallengeResponse, note: string) => void;
  onDelete: () => void;
  pending: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const muted = belief.status === "revised";
  const sorted = [...evidence].sort(
    (a, b) => movementFor(a.relevance).rank - movementFor(b.relevance).rank,
  );
  return (
    <article className="border border-ink/80 bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={`font-serif text-[19px] leading-snug ${muted ? "text-ink-muted line-through" : "text-ink"}`}
          >
            {belief.statement}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            <span>{belief.sector || "general"}</span>
            {belief.conviction != null && (
              <span className="inline-flex items-center gap-1.5 normal-case">
                Conviction <ConvictionMeter value={belief.conviction} />
              </span>
            )}
            {belief.horizon && <span className="normal-case">By {belief.horizon}</span>}
            {muted && <span className="text-accent">· revised</span>}
          </div>
          {belief.whatWouldBreakIt && (
            <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink-muted">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                Wrong if ·{" "}
              </span>
              {belief.whatWouldBreakIt}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Remove belief"
          className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-err"
        >
          Remove
        </button>
      </div>

      {sorted.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            {movementSummary(sorted)}
          </p>
          {sorted.map((c) => (
            <EvidenceCard
              key={c.id}
              challenge={c}
              pending={pending}
              onRespond={(response, note) => onRespond(c.id, response, note)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
          Nothing&apos;s moved this yet — it&apos;s being watched.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-accent transition-colors hover:text-ink"
      >
        {open ? "Hide history" : "See how this has evolved"}
      </button>
      {open && <EvolutionTimeline beliefId={belief.id} />}
    </article>
  );
}

export default function BeliefsPage(): JSX.Element {
  const beliefsQuery = useBeliefs();
  const challengesQuery = useBeliefChallenges();
  const { create, remove, run, respond } = useBeliefMutations();
  const [statement, setStatement] = useState("");
  const [sector, setSector] = useState("");
  const [conviction, setConviction] = useState<number | null>(null);
  const [horizon, setHorizon] = useState("");
  const [whatWouldBreakIt, setWhatWouldBreakIt] = useState("");

  const beliefs = beliefsQuery.data ?? [];
  const active = beliefs.filter((b) => b.status === "active");
  const revised = beliefs.filter((b) => b.status === "revised");
  const ordered = [...active, ...revised];
  const hasBeliefs = ordered.length > 0;

  const challenges = challengesQuery.data?.challenges ?? [];
  const evidenceFor = (beliefId: string): BeliefChallenge[] =>
    challenges.filter((c) => c.belief_id === beliefId);
  const movedCount = active.filter((b) => evidenceFor(b.id).length > 0).length;
  const hasRun = run.isSuccess || challenges.length > 0;

  const trimmed = statement.trim();
  const canAdd = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  const handleAdd = (e: FormEvent): void => {
    e.preventDefault();
    if (!canAdd) return;
    create.mutate(
      {
        statement: trimmed,
        sector: sector || null,
        conviction: conviction ?? null,
        horizon: horizon.trim() || null,
        whatWouldBreakIt: whatWouldBreakIt.trim() || null,
      },
      {
        onSuccess: () => {
          setStatement("");
          setSector("");
          setConviction(null);
          setHorizon("");
          setWhatWouldBreakIt("");
        },
      },
    );
  };

  // A manual check always forces a fresh pass (see the Tripwire note: a
  // non-forced run skips beliefs already checked this week and dead-ends).
  const handleCheck = (): void => {
    run.mutate(true);
  };

  const onRespond = (
    id: string,
    response: ChallengeResponse,
    note: string,
  ): void => {
    respond.mutate({ id, response, note: note.trim() || null });
  };

  return (
    <div className="theme-swiss min-h-[calc(100dvh-3.5rem)] bg-bg text-ink">
      <div className="mx-auto max-w-[860px] px-4 py-8 md:px-8">
        <header className="border-b-2 border-ink pb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Beliefs
          </p>
          <h1 className="mt-1 font-display text-[34px] font-black leading-none tracking-tight md:text-[42px]">
            How your thinking is evolving
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-muted">
            Write down what you believe across AI, finance, and semis. As new
            developments land, this surfaces what <em>strengthens</em> each belief
            and what <em>challenges</em> it — and keeps a running log of how your
            thinking actually moved, in your own words.
          </p>
        </header>

        {!hasBeliefs ? (
          <section className="mt-8">
            <div className="border border-line bg-surface px-6 py-10 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                Start here
              </p>
              <h2 className="mt-2 font-display text-[24px] font-black tracking-tight">
                Write down a belief
              </h2>
              <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
                Something you&apos;re betting on — a call about AI, the markets, or
                semis. From there, you&apos;ll watch how the evidence moves it over
                time.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3 border border-line bg-surface px-4 py-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                  {movedCount > 0
                    ? `${movedCount} belief${movedCount === 1 ? "" : "s"} moved this week`
                    : hasRun
                      ? "Quiet week — nothing's moved your beliefs"
                      : "Check what's moved your beliefs this week"}
                </span>
                {active.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCheck}
                    disabled={run.isPending}
                    className={GHOST_BTN}
                  >
                    {run.isPending ? "Checking…" : "Check now"}
                  </button>
                )}
              </div>
              {run.isError && (
                <p className="mt-2 text-sm text-err">{extractApiError(run.error)}</p>
              )}
            </section>

            <section className="mt-8 space-y-5">
              <SectionLabel>Your beliefs</SectionLabel>
              {ordered.map((b) => (
                <BeliefCard
                  key={b.id}
                  belief={b}
                  evidence={evidenceFor(b.id)}
                  pending={respond.isPending}
                  onRespond={onRespond}
                  onDelete={() => remove.mutate(b.id)}
                />
              ))}
            </section>
          </>
        )}

        {/* Add a belief. */}
        <section className="mt-10 pb-12">
          <SectionLabel>{hasBeliefs ? "Add a belief" : "Your first belief"}</SectionLabel>
          <form onSubmit={handleAdd} className="mt-3 space-y-3">
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={MAX_LEN}
              rows={2}
              placeholder="e.g. Transformer scaling keeps winning through 2027"
              className="w-full resize-none border border-line bg-surface px-3 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  Conviction
                </span>
                <div className="inline-flex border border-line">
                  {CONVICTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setConviction((c) => (c === n ? null : n))}
                      aria-pressed={conviction === n}
                      aria-label={`Conviction ${n}`}
                      className={`h-8 w-8 border-l border-line font-mono text-[12px] transition-colors first:border-l-0 ${
                        conviction != null && n <= conviction
                          ? "bg-accent text-accent-fg"
                          : "bg-surface text-ink-muted hover:text-ink"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <input
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
                maxLength={MAX_HORIZON}
                placeholder="By when? e.g. Q4 2026"
                className="min-w-[180px] flex-1 border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
            </div>

            <input
              value={whatWouldBreakIt}
              onChange={(e) => setWhatWouldBreakIt(e.target.value)}
              maxLength={MAX_BREAKER}
              placeholder="What would change your mind? (optional)"
              className="w-full border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
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
      </div>
    </div>
  );
}
