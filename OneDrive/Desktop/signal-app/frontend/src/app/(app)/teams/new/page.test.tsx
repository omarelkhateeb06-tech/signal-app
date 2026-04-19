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
  usePathname: () => "/teams/new",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/lib/api", () => ({
  createTeamRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import NewTeamPage from "./page";
import { useTeamsStore } from "@/store/teamsStore";

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<NewTeamPage />, { wrapper: Wrapper });
}

const createdTeam: Team = {
  id: "t1",
  name: "My Team",
  slug: "my-team",
  description: null,
  created_by: "u1",
  settings: { sectors: [] },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  role: "admin",
};

describe("NewTeamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockClear();
    useTeamsStore.getState().clear();
  });

  it("auto-derives slug from name", async () => {
    renderPage();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    const slugInput = screen.getByLabelText("Slug") as HTMLInputElement;

    await userEvent.type(nameInput, "My Awesome Team");

    await waitFor(() => expect(slugInput.value).toBe("my-awesome-team"));
  });

  it("submits and redirects to the new team", async () => {
    vi.mocked(api.createTeamRequest).mockResolvedValue(createdTeam);
    renderPage();

    await userEvent.type(screen.getByLabelText("Name"), "My Team");
    await userEvent.click(screen.getByRole("button", { name: /create team/i }));

    await waitFor(() =>
      expect(api.createTeamRequest).toHaveBeenCalledWith({
        name: "My Team",
        slug: "my-team",
        description: null,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith("/teams/t1");
    expect(useTeamsStore.getState().activeTeamId).toBe("t1");
  });

  it("shows validation errors for invalid slug", async () => {
    renderPage();

    const nameInput = screen.getByLabelText("Name");
    const slugInput = screen.getByLabelText("Slug");

    await userEvent.type(nameInput, "Valid Name");
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, "NO CAPS!");
    await userEvent.click(screen.getByRole("button", { name: /create team/i }));

    await waitFor(() => {
      const matches = screen.getAllByText(/lowercase letters, numbers, and hyphens/i);
      // Helper text is always present; error is a second occurrence.
      expect(matches.length).toBeGreaterThan(1);
    });
    expect(api.createTeamRequest).not.toHaveBeenCalled();
  });

  it("shows error message when API fails", async () => {
    vi.mocked(api.createTeamRequest).mockRejectedValue(new Error("bad"));
    renderPage();

    await userEvent.type(screen.getByLabelText("Name"), "My Team");
    await userEvent.click(screen.getByRole("button", { name: /create team/i }));

    await waitFor(() =>
      expect(screen.getByText("Failed to create team.")).toBeInTheDocument(),
    );
  });
});
