import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team, TeamMember } from "@/types/team";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  notFound: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "a@example.com", name: "A" },
    isAuthenticated: true,
    hasHydrated: true,
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getTeamRequest: vi.fn(),
  listTeamMembersRequest: vi.fn(),
  inviteTeamMemberRequest: vi.fn(),
  removeTeamMemberRequest: vi.fn(),
  listTeamInvitesRequest: vi.fn(),
  resendTeamInviteRequest: vi.fn(),
  revokeTeamInviteRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import TeamMembersPage from "./page";

const team: Team = {
  id: "t1",
  name: "Alpha",
  slug: "alpha",
  description: null,
  created_by: "u1",
  settings: { sectors: [] },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  role: "admin",
};

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: "m1",
    user_id: "u1",
    email: "a@example.com",
    name: "A",
    role: "admin",
    joined_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TeamMembersPage />, { wrapper: Wrapper });
}

function headerMatcher(expected: string) {
  return (_content: string, el: Element | null): boolean => {
    if (!el || el.tagName !== "P") return false;
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return text === expected;
  };
}

describe("TeamMembersPage header count pluralization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeamRequest).mockResolvedValue(team);
    vi.mocked(api.listTeamInvitesRequest).mockResolvedValue([]);
  });

  it("renders singular 'member' when count is 1", async () => {
    vi.mocked(api.listTeamMembersRequest).mockResolvedValue([makeMember()]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(headerMatcher("Alpha \u00b7 1 member")),
      ).toBeInTheDocument(),
    );
  });

  it("renders plural 'members' when count is 2+", async () => {
    vi.mocked(api.listTeamMembersRequest).mockResolvedValue([
      makeMember(),
      makeMember({
        id: "m2",
        user_id: "u2",
        email: "b@example.com",
        name: "B",
        role: "member",
      }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(headerMatcher("Alpha \u00b7 2 members")),
      ).toBeInTheDocument(),
    );
  });

  it("renders plural 'members' when count is 0", async () => {
    vi.mocked(api.listTeamMembersRequest).mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(headerMatcher("Alpha \u00b7 0 members")),
      ).toBeInTheDocument(),
    );
  });
});
