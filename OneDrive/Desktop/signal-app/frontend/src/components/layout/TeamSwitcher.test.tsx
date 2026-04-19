import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/types/team";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/feed",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/lib/api", () => ({
  listTeamsRequest: vi.fn(),
}));

import * as api from "@/lib/api";
import { TeamSwitcher } from "./TeamSwitcher";
import { useTeamsStore } from "@/store/teamsStore";

const sampleTeams: Team[] = [
  {
    id: "t1",
    name: "Alpha",
    slug: "alpha",
    description: null,
    created_by: "u1",
    settings: { sectors: [] },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    role: "admin",
  },
  {
    id: "t2",
    name: "Beta",
    slug: "beta",
    description: null,
    created_by: "u1",
    settings: { sectors: [] },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    role: "member",
  },
];

function renderWithClient(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TeamSwitcher />, { wrapper: Wrapper });
}

describe("TeamSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockClear();
    useTeamsStore.getState().clear();
  });

  it("shows 'Personal' when no active team and opens team list", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue(sampleTeams);
    renderWithClient();

    expect(screen.getByText("Personal")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /switch team/i }));
    await waitFor(() =>
      expect(screen.getByText("Alpha")).toBeInTheDocument(),
    );
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("selecting a team sets active team and navigates", async () => {
    vi.mocked(api.listTeamsRequest).mockResolvedValue(sampleTeams);
    renderWithClient();

    await userEvent.click(screen.getByRole("button", { name: /switch team/i }));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Alpha"));

    expect(useTeamsStore.getState().activeTeamId).toBe("t1");
    expect(pushMock).toHaveBeenCalledWith("/teams/t1");
  });

  it("'Personal feed' clears the active team", async () => {
    useTeamsStore.getState().setActiveTeam("t1");
    vi.mocked(api.listTeamsRequest).mockResolvedValue(sampleTeams);
    renderWithClient();

    await userEvent.click(screen.getByRole("button", { name: /switch team/i }));
    await userEvent.click(screen.getByText("Personal feed"));

    expect(useTeamsStore.getState().activeTeamId).toBeNull();
    expect(pushMock).toHaveBeenCalledWith("/feed");
  });
});
