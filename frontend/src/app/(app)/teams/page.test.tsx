import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/types/team";

vi.mock("@/lib/api", () => ({
  listTeamsRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import TeamsListPage from "./page";

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TeamsListPage />, { wrapper: Wrapper });
}

const sampleTeam: Team = {
  id: "t1",
  name: "Alpha",
  slug: "alpha",
  description: "My team",
  created_by: "u1",
  settings: { sectors: [] },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  role: "admin",
};

describe("TeamsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no teams", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue([]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/not on any teams yet/i)).toBeInTheDocument(),
    );
  });

  it("lists teams with role badges", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue([sampleTeam]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("My team")).toBeInTheDocument();
  });

  it("shows error state when the request fails", async () => {
    vi.mocked(api.listTeamsRequest).mockRejectedValue(new Error("boom"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Failed to load teams.")).toBeInTheDocument(),
    );
  });
});
