"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import type {
  TeamDashboardTopStory,
  TeamMember,
  TeamRole,
} from "@/types/team";

export interface DashboardChartsProps {
  members: TeamMember[];
  topStories: TeamDashboardTopStory[];
}

const ROLE_COLORS: Record<TeamRole, string> = {
  admin: "#2563eb",
  member: "#10b981",
  viewer: "#94a3b8",
};

const ROLE_ORDER: TeamRole[] = ["admin", "member", "viewer"];

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function ChartCard({
  title,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-3 text-sm font-semibold text-slate-900">
        {title}
      </div>
      {isEmpty ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="p-4">{children}</div>
      )}
    </section>
  );
}

export default function DashboardCharts({
  members,
  topStories,
}: DashboardChartsProps): JSX.Element {
  const roleData = useMemo(() => {
    const counts: Record<TeamRole, number> = {
      admin: 0,
      member: 0,
      viewer: 0,
    };
    for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1;
    return ROLE_ORDER.filter((role) => counts[role] > 0).map((role) => ({
      name: role,
      value: counts[role],
      color: ROLE_COLORS[role],
    }));
  }, [members]);

  const storyData = useMemo(
    () =>
      topStories.map((s) => ({
        name: truncate(s.headline, 20),
        fullName: s.headline,
        saves: s.save_count,
      })),
    [topStories],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Member roles"
        isEmpty={roleData.length === 0}
        emptyMessage="No members yet."
      >
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={roleData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
              label={(entry: { name?: string; value?: number }) =>
                `${entry.name ?? ""} (${entry.value ?? 0})`
              }
            >
              {roleData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Top saved stories"
        isEmpty={storyData.length === 0}
        emptyMessage="No saves yet."
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={storyData}
            margin={{ top: 10, right: 10, left: 0, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="name"
              interval={0}
              angle={-20}
              textAnchor="end"
              height={60}
              tick={{ fontSize: 11, fill: "#475569" }}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#475569" }} />
            <Tooltip
              formatter={(value) => [value as number, "Saves"]}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { fullName?: string } } | undefined;
                return item?.payload?.fullName ?? "";
              }}
            />
            <Bar dataKey="saves" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
