import { escapeHtml, renderLayout } from "./layout";

export interface TeamInviteEmailInput {
  inviteeEmail: string;
  teamName: string;
  inviterName: string | null;
  role: "admin" | "member" | "viewer";
  inviteUrl: string;
  expiresInDays: number;
  frontendUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderTeamInviteEmail(input: TeamInviteEmailInput): RenderedEmail {
  const inviter = input.inviterName?.trim() || "A teammate";
  const subject = `${inviter} invited you to ${input.teamName} on SIGNAL`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;">You're invited to ${escapeHtml(input.teamName)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      ${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(input.teamName)}</strong> on SIGNAL as a ${escapeHtml(input.role)}.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${input.inviteUrl}"
         style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">
        Accept invitation
      </a>
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b;">
      This invite expires in ${input.expiresInDays} days and can only be used once.
    </p>
    <p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">
      Or paste this link into your browser: ${escapeHtml(input.inviteUrl)}
    </p>`;

  const html = renderLayout({
    title: subject,
    previewText: `${inviter} invited you to ${input.teamName} on SIGNAL.`,
    bodyHtml,
    frontendUrl: input.frontendUrl,
  });

  const text = [
    `You're invited to ${input.teamName} on SIGNAL`,
    "",
    `${inviter} invited you to join ${input.teamName} as a ${input.role}.`,
    `Accept your invite (expires in ${input.expiresInDays} days):`,
    input.inviteUrl,
  ].join("\n");

  return { subject, html, text };
}
