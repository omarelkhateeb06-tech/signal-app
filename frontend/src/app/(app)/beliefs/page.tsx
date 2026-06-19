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

// Tripwire — the redesign's home surface. SIGNAL is no longer a feed you read;
// it's a silent watch over the POSITIONS you've staked. The reader declares a
// position (a claim + how hard they're betting + by when + what would prove
// them wrong); the system stays quiet until a development moves one, then fires
// an ALERT. The empty screen is the feature — insurance, not media.
//
// Internally these are still "beliefs"/"challenges" (the table names and the
// /beliefs route are unchanged); only the language the reader sees is positions
// and alerts.

const SECTORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "General" },
  { value: "ai", label: "AI" },
  { value: "finance", label: "Finance" },
  { value: "semiconductors", label: "Semiconductors" },
];

// Mirror the backend limits (beliefController: MIN/MAX_CONVICTION,
// MAX_HORIZON_LENGTH, MAX_BREAKER_LENGTH) so the form fails fast client-side.
const MIN_LEN = 8;
const MAX_LEN = 280;
const MAX_HORIZON = 80;
const MAX_BREAKER = 280;
const CONVICTIONS = [1, 2, 3, 4, 5] as const;

const PRIMARY_BTN =
  "inline-flex items-center justify-center border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BTN =
  "inline-flex items-center justify-center border border-line px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50";

// How each relevance class is presented. `rank` orders the alert list
// loud-first. Tailwind needs literal class names, so border/text are spelled
// out (no dynamic `text-${tone}`). All four tones map to real theme tokens.
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

// A position's headline status, derived from its live (unresponded) alerts.
// Three states per the redesign: under-pressure (something's moving against
// it), confirmed (a development backs it), or quiet (the silent default).
interface PositionStatus {
  label: string;
  dot: string;
  text: string;
}
function positionStatus(
  belief: Belief,
  alerts: ReadonlyArray<BeliefChallenge>,
): PositionStatus {
  if (belief.status === "revised") {
    return { label: "Revised", dot: "bg-ink-muted", text: "text-ink-muted" };
  }
  const live = alerts.filter(
    (a) => a.belief_id === belief.id && a.response == null,
  );
  if (live.some((a) => a.relevance === "contradicts"))
    return { label: "Under pressure", dot: "bg-err", text: "text-err" };
  if (live.some((a) => a.relevance === "pressures"))
    return { label: "Under pressure", dot: "bg-warn", text: "text-warn" };
  if (live.some((a) => a.relevance === "supports"))
    return { label: "Confirmed", dot: "bg-ok", text: "text-ok" };
  return { label: "Quiet", dot: "bg-ink-muted/50", text: "text-ink-muted" };
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

function AlertCard({
  alert,
  onRespond,
  pending,
}: {
  alert: BeliefChallenge;
  onRespond: (r: ChallengeResponse) => void;
  pending: boolean;
}): JSX.Element {
  const responded = alert.response != null;
  const meta = metaFor(alert.relevance);
  return (
    <article className="border border-ink/80 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Your position
          </p>
          <p className="mt-1.5 font-serif text-[19px] leading-snug text-ink">
            {alert.statement}
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
          {alert.how_to_update}
        </p>
      </div>

      {alert.dissent && (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
            {meta.dissentLabel}
          </p>
          <p className="mt-1 max-w-[64ch] font-serif text-[14px] italic leading-relaxed text-ink-muted">
            {alert.dissent}
          </p>
        </div>
      )}

      {alert.source_headline && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          Triggered by ·{" "}
          <span className="normal-case text-ink">{alert.source_headline}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {responded ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            {alert.response === "revised"
              ? "✓ You revised this"
              : alert.response === "held"
                ? "You held your position"
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

function PositionRow({
  belief,
  alerts,
  onDelete,
}: {
  belief: Belief;
  alerts: ReadonlyArray<BeliefChallenge>;
  onDelete: () => void;
}): JSX.Element {
  const status = positionStatus(belief, alerts);
  const muted = belief.status === "revised";
  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={`text-[15px] leading-snug ${muted ? "text-ink-muted line-through" : "text-ink"}`}
          >
            {belief.statement}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            <span className={`inline-flex items-center gap-1.5 ${status.text}`}>
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
            <span>{belief.sector || "general"}</span>
            {belief.conviction != null && (
              <span className="inline-flex items-center gap-1.5 normal-case">
                Conviction <ConvictionMeter value={belief.conviction} />
              </span>
            )}
            {belief.horizon && <span className="normal-case">By {belief.horizon}</span>}
          </div>
          {belief.whatWouldBreakIt && (
            <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink-muted">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                Breaks if ·{" "}
              </span>
              {belief.whatWouldBreakIt}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Remove position"
          className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-err"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export default function PositionsPage(): JSX.Element {
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
  const hasPositions = active.length > 0 || revised.length > 0;

  const challenges = challengesQuery.data?.challenges ?? [];
  const sortedAlerts = [...challenges].sort(
    (a, b) => metaFor(a.relevance).rank - metaFor(b.relevance).rank,
  );
  const livePressure = challenges.filter(
    (c) => isLoud(c.relevance) && c.response == null,
  ).length;
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

  // A manual run always forces (force=true): an explicit click means "check my
  // positions now". A non-forced run would skip any position already marked
  // checked this week and leave the reader dead-ended on an empty state. The
  // cost guard still protects the future automated event-driven path (Phase ⑤).
  const handleRunCheck = (): void => {
    run.mutate(true);
  };

  return (
    <div className="theme-swiss min-h-[calc(100dvh-3.5rem)] bg-bg text-ink">
      <div className="mx-auto max-w-[860px] px-4 py-8 md:px-8">
        <header className="border-b-2 border-ink pb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Tripwire
          </p>
          <h1 className="mt-1 font-display text-[34px] font-black leading-none tracking-tight md:text-[42px]">
            Your Positions
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-muted">
            The stakes you&apos;re tracking across AI, finance, and semis.
            Tripwire stays silent — no feed, no noise — until a development
            actually moves one of your positions. Then it tells you, and tells
            you what to do about it.
          </p>
        </header>

        {!hasPositions ? (
          // First run: the empty screen is the feature, so make the one action
          // that matters unmistakable.
          <section className="mt-8">
            <div className="border border-line bg-surface px-6 py-10 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                Start here
              </p>
              <h2 className="mt-2 font-display text-[24px] font-black tracking-tight">
                Stake your first position
              </h2>
              <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
                Name something you&apos;re betting on — a call about AI, the
                markets, or semis. Tripwire watches the wires and stays silent
                until something actually moves it.
              </p>
            </div>
          </section>
        ) : (
          <>
            {/* Status strip — the calm/loud signal at a glance. */}
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3 border border-line bg-surface px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`h-2 w-2 rounded-full ${livePressure > 0 ? "bg-warn" : "bg-ok"}`}
                  />
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                    {livePressure > 0
                      ? `${livePressure} position${livePressure === 1 ? "" : "s"} under pressure`
                      : "All quiet"}
                  </span>
                </div>
                {active.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRunCheck}
                    disabled={run.isPending}
                    className={GHOST_BTN}
                  >
                    {run.isPending ? "Checking…" : "Check now"}
                  </button>
                )}
              </div>
            </section>

            {/* Alerts — what moved, loud-first. */}
            <section className="mt-8">
              <SectionLabel>Alerts</SectionLabel>
              <div className="mt-4">
                {run.isPending ? (
                  <p className="text-[15px] leading-relaxed text-ink-muted">
                    Scanning this week&apos;s developments against your
                    positions…
                  </p>
                ) : sortedAlerts.length > 0 ? (
                  <div className="space-y-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                      {livePressure > 0
                        ? `${livePressure} development${livePressure === 1 ? "" : "s"} moving your positions`
                        : "Nothing's moving a position — here's what's adjacent"}
                    </p>
                    {sortedAlerts.map((a) => (
                      <AlertCard
                        key={a.id}
                        alert={a}
                        pending={respond.isPending}
                        onRespond={(r) => respond.mutate({ id: a.id, response: r })}
                      />
                    ))}
                  </div>
                ) : hasRun ? (
                  <p className="text-[15px] leading-relaxed text-ink-muted">
                    All quiet. Nothing has moved your positions — that&apos;s the
                    point. Check back as new developments land.
                  </p>
                ) : (
                  <p className="text-[15px] leading-relaxed text-ink-muted">
                    Tripwire checks your positions against new developments.
                    Run a check now — soon this happens automatically.
                  </p>
                )}
                {run.isError && (
                  <p className="mt-2 text-sm text-err">{extractApiError(run.error)}</p>
                )}
              </div>
            </section>

            {/* Tracked positions. */}
            <section className="mt-10">
              <SectionLabel>Positions</SectionLabel>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {active.map((b) => (
                  <PositionRow
                    key={b.id}
                    belief={b}
                    alerts={challenges}
                    onDelete={() => remove.mutate(b.id)}
                  />
                ))}
                {revised.map((b) => (
                  <PositionRow
                    key={b.id}
                    belief={b}
                    alerts={challenges}
                    onDelete={() => remove.mutate(b.id)}
                  />
                ))}
              </ul>
            </section>
          </>
        )}

        {/* Stake a position. */}
        <section className="mt-10 pb-12">
          <SectionLabel>{hasPositions ? "Stake a position" : "Your position"}</SectionLabel>
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
              placeholder="What would prove you wrong? (a sharp falsifier makes alerts sharper)"
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
                {create.isPending ? "Staking…" : "Stake position"}
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
