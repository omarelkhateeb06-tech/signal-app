// Phase 12i — daily digest email template. Sector-grouped layout: up
// to ~10 top stories from the trailing 24h, ranked by editorial score
// and split into "AI", "Finance", "Semiconductors" sections. The brand
// surface stays "SIGNAL" (the conversational "Valo" rebrand is
// deferred until a coordinated rename pass).

import { escapeHtml, renderLayout } from "./layout";
import type { DailyDigestStory } from "../services/digestService";

export interface DailyDigestEmailInput {
  email: string;
  storiesBySector: ReadonlyMap<string, DailyDigestStory[]>;
  dayLabel: string;
  frontendUrl: string;
  unsubscribeUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Per-sector hex dots match the in-app SectorBadge palette. Bare hex
// is intentional — inline CSS is the only thing email clients reliably
// honor.
const SECTOR_PRESENTATION: Record<string, { label: string; color: string }> = {
  ai: { label: "AI", color: "#7c3aed" },
  finance: { label: "Finance", color: "#16a34a" },
  semiconductors: { label: "Semiconductors", color: "#dc2626" },
};

function presentSector(slug: string): { label: string; color: string } {
  return (
    SECTOR_PRESENTATION[slug] ?? {
      label: slug.charAt(0).toUpperCase() + slug.slice(1),
      color: "#64748b",
    }
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function renderStory(story: DailyDigestStory, frontendUrl: string): string {
  const link = `${frontendUrl}/stories/${story.id}`;
  const headline = escapeHtml(story.headline);
  const body = story.commentary
    ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(truncate(story.commentary, 320))}</p>`
    : "";
  const source = story.sourceName
    ? `<span style="color:#94a3b8;font-size:12px;"> · ${escapeHtml(story.sourceName)}</span>`
    : "";

  return `
    <div style="padding:18px 0;border-top:1px solid #e2e8f0;">
      <h3 style="margin:0 0 8px;font-size:17px;line-height:1.35;font-weight:600;">
        <a href="${link}" style="color:#0f172a;text-decoration:none;">${headline}</a>${source}
      </h3>
      ${body}
      <p style="margin:0;font-size:13px;">
        <a href="${link}" style="color:#7c3aed;text-decoration:none;font-weight:500;">
          See your personalized analysis →
        </a>
      </p>
    </div>`;
}

function renderSectorSection(
  sectorSlug: string,
  stories: DailyDigestStory[],
  frontendUrl: string,
): string {
  const { label, color } = presentSector(sectorSlug);
  const sectorHeader = `
    <div style="padding:24px 0 8px;">
      <p style="margin:0;font-size:12px;letter-spacing:0.1em;color:${color};font-weight:700;text-transform:uppercase;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${color};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(label)}
      </p>
    </div>`;
  const cards = stories.map((s) => renderStory(s, frontendUrl)).join("\n");
  return sectorHeader + cards;
}

export function renderDailyDigestEmail(
  input: DailyDigestEmailInput,
): RenderedEmail {
  const subject = `Your SIGNAL Daily — ${input.dayLabel}`;
  const total = Array.from(input.storiesBySector.values()).reduce(
    (n, arr) => n + arr.length,
    0,
  );

  const sectorHtml = Array.from(input.storiesBySector.entries())
    .map(([sector, stories]) => renderSectorSection(sector, stories, input.frontendUrl))
    .join("\n");

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;color:#64748b;text-transform:uppercase;font-weight:600;">SIGNAL Daily · ${escapeHtml(input.dayLabel)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;">The ${total} ${total === 1 ? "story" : "stories"} that matter today.</h1>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155;">
      Ranked across your sectors. Tap any story for commentary tailored to your role.
    </p>
    ${sectorHtml}
    <p style="margin:32px 0 0;">
      <a href="${input.frontendUrl}/feed"
         style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;">
        Open your feed
      </a>
    </p>`;

  const html = renderLayout({
    title: subject,
    previewText: `${total} top stories from the last 24 hours.`,
    bodyHtml,
    frontendUrl: input.frontendUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  // Plain-text fallback. SendGrid auto-strips HTML for the text part
  // by default but a tailored version gives accessibility tools and
  // text-only clients a saner read.
  const lines: string[] = [
    `SIGNAL Daily — ${input.dayLabel}`,
    `The ${total} ${total === 1 ? "story" : "stories"} that matter today.`,
    "",
  ];
  for (const [sector, stories] of input.storiesBySector) {
    lines.push(`[${presentSector(sector).label}]`);
    for (const s of stories) {
      lines.push(`• ${s.headline}`);
      if (s.commentary) lines.push(`  ${truncate(s.commentary, 200)}`);
      lines.push(`  ${input.frontendUrl}/stories/${s.id}`);
    }
    lines.push("");
  }
  lines.push(`Open your feed: ${input.frontendUrl}/feed`);

  return { subject, html, text: lines.join("\n") };
}
