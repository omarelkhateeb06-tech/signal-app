import { escapeHtml, renderLayout } from "./layout";

export interface PasswordResetEmailInput {
  name: string | null;
  email: string;
  resetUrl: string;
  expiresInMinutes: number;
  frontendUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const greetName = input.name?.trim() || input.email.split("@")[0] || "there";
  const subject = "Reset your SIGNAL password";

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      Hi ${escapeHtml(greetName)}, we got a request to reset the password for your SIGNAL account.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${input.resetUrl}"
         style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">
        Choose a new password
      </a>
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b;">
      This link expires in ${input.expiresInMinutes} minutes. If you didn't request a reset, you can ignore this email —
      your password will stay the same.
    </p>
    <p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">
      Or paste this link into your browser: ${escapeHtml(input.resetUrl)}
    </p>`;

  const html = renderLayout({
    title: subject,
    previewText: "Reset your SIGNAL password.",
    bodyHtml,
    frontendUrl: input.frontendUrl,
  });

  const text = [
    `Reset your SIGNAL password`,
    "",
    `Hi ${greetName}, we got a request to reset your password.`,
    `Open this link (expires in ${input.expiresInMinutes} minutes):`,
    input.resetUrl,
    "",
    "If you didn't request this, ignore this email.",
  ].join("\n");

  return { subject, html, text };
}
