import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  TeamDashboardTopStory,
  TeamMember,
} from "@/types/team";

vi.mock("recharts", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", {}, children);
  return {
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: Passthrough,
    Cell: Passthrough,
    BarChart: Passthrough,
    Bar: Passthrough,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

import DashboardCharts from "./DashboardCharts";

const member = (role: TeamMember["role"], i: number): TeamMember => ({
  id: `m${i}`,
  user_id: `u${i}`,
  role,
  joined_at: "2026-01-01T00:00:00Z",
  email: `m${i}@example.com`,
  name: `Member ${i}`,
});

describe("DashboardCharts", () => {
  it("renders both chart cards with data", () => {
    const members: TeamMember[] = [
      member("admin", 1),
      member("member", 2),
      member("member", 3),
      member("viewer", 4),
    ];
    const topStories: TeamDashboardTopStory[] = [
      { id: "s1", headline: "Big AI Breakthrough", sector: "ai", save_count: 5 },
    ];

    render(<DashboardCharts members={members} topStories={topStories} />);

    expect(screen.getByText(/member roles/i)).toBeInTheDocument();
    expect(screen.getByText(/top saved stories/i)).toBeInTheDocument();
    // No empty-state messages when data is present
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no saves yet/i)).not.toBeInTheDocument();
  });

  it("shows empty states when data is missing", () => {
    render(<DashboardCharts members={[]} topStories={[]} />);
    expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no saves yet/i)).toBeInTheDocument();
  });
});
