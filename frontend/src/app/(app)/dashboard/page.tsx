"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboard } from "@/hooks/useDashboard";
import { useInFocus } from "@/hooks/useInFocus";
import { extractApiError } from "@/lib/api";

const SECTOR_COLOR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};
const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semis",
};

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 0,
  fontSize: 12,
  color: "var(--ink)",
} as const;

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="border border-line bg-surface/50 px-5 py-4">
      <div className="font-display text-[32px] font-bold leading-none text-ink">
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        {label}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="border border-line p-4">
      <h2 className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DashboardPage(): JSX.Element {
  const { data, isLoading, error } = useDashboard();
  const { data: topics } = useInFocus();

  return (
    <div className="space-y-8 pb-12">
      <header className="border-b-2 border-line pb-4">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink md:text-[30px]">
          Intelligence Dashboard
        </h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          Coverage across AI · Finance · Semiconductors
        </p>
      </header>

      {isLoading && (
        <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>
      )}

      {error && (
        <div className="border border-err/40 bg-err/5 p-4 text-sm text-err">
          {extractApiError(error, "Failed to load dashboard.")}
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-4">
            <Stat label="Events · 30 days" value={data.total_events_30d} />
            <Stat label="Sectors tracked" value={data.sector_counts.length} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title="Events by sector · 30 days">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.sector_counts}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--line)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="sector"
                      tickFormatter={(s: string) => SECTOR_LABEL[s] ?? s}
                      stroke="var(--ink-muted)"
                      fontSize={11}
                    />
                    <YAxis allowDecimals={false} stroke="var(--ink-muted)" fontSize={11} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "var(--line)", opacity: 0.3 }}
                      labelFormatter={(label) =>
                        SECTOR_LABEL[String(label)] ?? String(label)
                      }
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {data.sector_counts.map((s) => (
                        <Cell
                          key={s.sector}
                          fill={SECTOR_COLOR[s.sector] ?? "var(--accent)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Daily volume · 14 days">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.volume_by_day}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--line)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(5)}
                      stroke="var(--ink-muted)"
                      fontSize={10}
                    />
                    <YAxis allowDecimals={false} stroke="var(--ink-muted)" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {topics && topics.length > 0 && (
            <Panel title="In Focus">
              <div className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <Link
                    key={t.topic}
                    href={`/search?q=${encodeURIComponent(t.topic)}`}
                    className="inline-flex items-center gap-1 border border-line px-2 py-0.5 font-mono text-[11px] text-ink-muted transition-colors hover:border-accent hover:text-accent hover:no-underline"
                  >
                    {t.topic}
                    <span className="text-[9px] text-line">{t.count}</span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {data.sector_counts.length === 0 && (
            <p className="border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-muted">
              No events in the last 30 days yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
