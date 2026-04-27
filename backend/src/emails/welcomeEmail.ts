import { escapeHtml, renderLayout } from "./layout";

export interface WelcomeEmailInput {
  name: string | null;
  email: string;
  frontendUrl: string;
  unsubscribeUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const greetName = input.name?.trim() || input.email.split("@")[0] || "there";
  const subject = "Welcome to SIGNAL";
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;">Welcome to SIGNAL, ${escapeHtml(greetName)}.</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      You just joined a curated daily feed for AI, finance, and semiconductor professionals — each story ends with
      <em>why it matters to you</em>, written for your role.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
      Tell us what you care about so the feed starts working for you.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${input.frontendUrl}/onboarding"
         style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">
        Finish setting up
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#64748b;">What happens next:</p>
    <ul style="margin:0 0 16px 20px;padding:0;color:#334155;font-size:14px;line-height:1.7;">
      <li>Your feed will load as soon as you pick a sector and role.</li>
      <li>Every Monday you'll get a short weekly digest with the top stories.</li>
      <li>Save stories and leave comments to track what's driving your thinking.</li>
    </ul>`;

  const html = renderLayout({
    title: subject,
    previewText: "Your curated feed is ready — tell us what you care about.",
    bodyHtml,
    frontendUrl: input.frontendUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const text = [
    `Welcome to SIGNAL, ${greetName}.`,
    "",
    "You just joined a curated daily feed for AI, finance, and semiconductor professionals.",
    "Each story ends with why it matters to you, written for your role.",
    "",
    `Finish setting up: ${input.frontendUrl}/onboarding`,
  ].join("\n");

  return { subject, html, text };
}
