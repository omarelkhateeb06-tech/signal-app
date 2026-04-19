import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingTeamInvite } from "@/types/team";

vi.mock("@/lib/api", () => ({
  listTeamInvitesRequest: vi.fn(),
  resendTeamInviteRequest: vi.fn(),
  revokeTeamInviteRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import { PendingInvites } from "./PendingInvites";

const samplePending: PendingTeamInvite = {
  id: "inv-1",
  email: "pending@example.com",
  role: "member",
  expires_at: "2026-05-01T00:00:00Z",
  used_at: null,
  created_at: "2026-04-10T00:00:00Z",
  invited_by: "u1",
  status: "pending",
};

function renderList(isAdmin = true): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<PendingInvites teamId="t1" isAdmin={isAdmin} />, { wrapper: Wrapper });
}

describe("PendingInvites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pending invites with a count badge and admin actions", async () => {
    vi.mocked(api.listTeamInvitesRequest).mockResolvedValue([samplePending]);
    renderList(true);

    expect(
      await screen.findByText("pending@example.com"),
    ).toBeInTheDocument();
    // Count badge
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend invite to pending/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /revoke invite to pending/i }),
    ).toBeInTheDocument();
  });

  it("hides resend/revoke buttons for non-admins", async () => {
    vi.mocked(api.listTeamInvitesRequest).mockResolvedValue([samplePending]);
    renderList(false);

    await screen.findByText("pending@example.com");
    expect(
      screen.queryByRole("button", { name: /resend invite/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revoke invite/i }),
    ).not.toBeInTheDocument();
  });

  it("opens a confirm dialog before revoking and calls revoke on confirm", async () => {
    vi.mocked(api.listTeamInvitesRequest).mockResolvedValue([samplePending]);
    vi.mocked(api.revokeTeamInviteRequest).mockResolvedValue(undefined);

    renderList(true);
    await screen.findByText("pending@example.com");

    await userEvent.click(
      screen.getByRole("button", { name: /revoke invite to pending/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/revoke invite\?/i);

    await userEvent.click(
      screen.getByRole("button", { name: /^revoke$/i }),
    );

    await waitFor(() =>
      expect(api.revokeTeamInviteRequest).toHaveBeenCalledWith("t1", "inv-1"),
    );
  });

  it("shows empty state when there are no invites", async () => {
    vi.mocked(api.listTeamInvitesRequest).mockResolvedValue([]);
    renderList(true);
    expect(await screen.findByText(/no invites yet/i)).toBeInTheDocument();
  });
});
