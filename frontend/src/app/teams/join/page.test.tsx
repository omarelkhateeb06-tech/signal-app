import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteMetadata } from "@/types/team";

const replaceMock = vi.fn();
const searchParamsGet = vi.fn<(key: string) => string | null>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/teams/join",
  useSearchParams: () => ({ get: searchParamsGet }),
  useParams: () => ({}),
}));

vi.mock("@/lib/api", () => ({
  inviteMetadataRequest: vi.fn(),
  inviteAcceptRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import JoinTeamPage from "./page";
import { useAuthStore } from "@/store/authStore";
import { useTeamsStore } from "@/store/teamsStore";

const pendingMetadata: InviteMetadata = {
  team_name: "Alpha",
  team_slug: "alpha",
  email: "new@example.com",
  role: "member",
  expires_at: "2026-05-01T00:00:00Z",
  status: "valid",
};

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<JoinTeamPage />, { wrapper: Wrapper });
}

describe("JoinTeamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaceMock.mockClear();
    searchParamsGet.mockReset();
    searchParamsGet.mockReturnValue("token-abc");
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      hasHydrated: true,
    });
    useTeamsStore.getState().clear();
  });

  it("shows a missing-token state when no token query param", async () => {
    searchParamsGet.mockReturnValue(null);
    renderPage();
    expect(
      await screen.findByText(/invitation link is missing a token/i),
    ).toBeInTheDocument();
  });

  it("shows expired state when metadata status is expired", async () => {
    vi.mocked(api.inviteMetadataRequest).mockResolvedValue({
      ...pendingMetadata,
      status: "expired",
    });
    renderPage();
    expect(
      await screen.findByText(/invitation has expired/i),
    ).toBeInTheDocument();
  });

  it("shows used state when metadata status is used", async () => {
    vi.mocked(api.inviteMetadataRequest).mockResolvedValue({
      ...pendingMetadata,
      status: "used",
    });
    renderPage();
    expect(
      await screen.findByText(/already been accepted/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /go to sign in/i }),
    ).toBeInTheDocument();
  });

  it("shows invalid state when metadata fetch fails", async () => {
    vi.mocked(api.inviteMetadataRequest).mockRejectedValue(new Error("boom"));
    renderPage();
    expect(
      await screen.findByText(/invitation link is invalid/i),
    ).toBeInTheDocument();
  });

  it("signup tab: creates account, sets auth + active team, redirects", async () => {
    vi.mocked(api.inviteMetadataRequest).mockResolvedValue(pendingMetadata);
    vi.mocked(api.inviteAcceptRequest).mockResolvedValue({
      team: { id: "team-1", name: "Alpha", slug: "alpha" },
      user: { id: "u2", email: "new@example.com", name: "New Person" },
      role: "member",
      created: true,
      token: "jwt-xyz",
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Join Alpha/i)).toBeInTheDocument(),
    );

    await userEvent.type(screen.getByLabelText(/full name/i), "New Person");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2hunter2");
    await userEvent.click(
      screen.getByRole("button", { name: /create account & join/i }),
    );

    await waitFor(() => {
      expect(api.inviteAcceptRequest).toHaveBeenCalledWith({
        token: "token-abc",
        password: "hunter2hunter2",
        name: "New Person",
      });
    });
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/teams/team-1"),
    );
    expect(useAuthStore.getState().token).toBe("jwt-xyz");
    expect(useTeamsStore.getState().activeTeamId).toBe("team-1");
  });

  it("authed with mismatched email prompts the user to log out", async () => {
    useAuthStore.setState({
      user: {
        id: "u1",
        email: "other@example.com",
        name: "Other",
      },
      token: "existing-jwt",
      isAuthenticated: true,
      hasHydrated: true,
    });
    vi.mocked(api.inviteMetadataRequest).mockResolvedValue(pendingMetadata);

    renderPage();

    expect(
      await screen.findByText(/different account signed in/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /log out and continue/i }),
    ).toBeInTheDocument();
  });
});
