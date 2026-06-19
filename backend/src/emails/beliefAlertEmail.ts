import { escapeHtml, renderLayout } from "./layout";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Only material alerts are emailed — a development that contradicts or pressures
// a position. supports/watch live on the in-app radar but aren't worth an
// interruption (see beliefAlertService.isMaterial).
export type BeliefAlertRelevance = "contradicts" | "pressures";

export interface BeliefAlertEmailInput {
  toName: string | null;
  positionStatement: string;
  relevance: BeliefAlertRelevance;
  howToUpdate: string;
  dissent: string | null;
  sourceHeadline: string | null;
  frontendUrl: string;
  unsubscribeUrl?: string;
}

const RELEVANCE_COPY: Record<
  BeliefAlertRelevance,
  { eyebrow: string; subject: string; color: string }
> = {
  contradicts: {
    eyebrow: "Reconsider",
    subject: "A development contradicts a position you hold",
    color: "#dc2626",
  },
  pressures: {
    eyebrow: "Under pressure",
    subject: "A development is pressuring a position you hold",
    color: "#d97706",
  },
};

// A position alert email — the off-screen twin of the in-app AlertCard. The
// reader staked a position; Tripwire stayed silent until something moved it.
// Lead with the position, then what to do about it, then the honest counter-case.
export function renderBeliefAlertEmail(input: BeliefAlertEmailInput): RenderedEmail {
  const copy = RELEVANCE_COPY[input.relevance];
  const greet = input.toName?.trim();
  const subject = copy.subject;

  const dissentBlock = input.dissent
    ? `<p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">The case it still holds</p>
       <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;font-style:italic;">${escapeHtml(input.dissent)}</p>`
    : "";

  const sourceBlock = input.sourceHeadline
    ? `<p style="margin:0 0 20px;font-size:13px;color:#64748b;">Triggered by: <span style="color:#0f172a;">${escapeHtml(input.sourceHeadline)}</span></p>`
    : "";

  const lead = greet
    ? `${escapeHtml(greet)}, a development just moved a position you're tracking.`
    : "A development just moved a position you're tracking.";

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:${copy.color};font-weight:700;">Tripwire · ${escapeHtml(copy.eyebrow)}</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.35;">${lead}</h1>
    <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Your position</p>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#0f172a;">${escapeHtml(input.positionStatement)}</p>
    <div style="border-left:3px solid ${copy.color};padding:8px 0 8px 16px;margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${copy.color};font-weight:700;">What to do about it</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(input.howToUpdate)}</p>
    </div>
    ${dissentBlock}
    ${sourceBlock}
    <p style="margin:0 0 24px;">
      <a href="${input.frontendUrl}/beliefs"
         style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">
        Review your positions
      </a>
    </p>`;

  const html = renderLayout({
    title: subject,
    previewText: input.howToUpdate.slice(0, 140),
    bodyHtml,
    frontendUrl: input.frontendUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const text = [
    `Tripwire — ${copy.eyebrow}`,
    "",
    lead,
    "",
    `Your position: ${input.positionStatement}`,
    "",
    `What to do about it: ${input.howToUpdate}`,
    ...(input.dissent ? ["", `The case it still holds: ${input.dissent}`] : []),
    ...(input.sourceHeadline ? ["", `Triggered by: ${input.sourceHeadline}`] : []),
    "",
    `Review your positions: ${input.frontendUrl}/beliefs`,
  ].join("\n");

  return { subject, html, text };
}
