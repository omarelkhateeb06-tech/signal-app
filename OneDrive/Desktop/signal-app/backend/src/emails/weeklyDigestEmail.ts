import { escapeHtml, renderLayout } from "./layout";

export interface DigestStory {
  id: string;
  sector: string;
  headline: string;
  context: string;
  whyItMatters: string;
  sourceName: string | null;
  publishedAt: Date | string | null;
  saveCount: number;
  commentCount: number;
}

export interface WeeklyDigestEmailInput {
  name: string | null;
  email: string;
  stories: DigestStory[];
  weekLabel: string;
  frontendUrl: string;
  unsubscribeUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function renderStory(story: DigestStory, frontendUrl: string): string {
  const link = `${frontendUrl}/stories/${story.id}`;
  const sector = escapeHtml(story.sector.toUpperCase());
  const headline = escapeHtml(story.headline);
  const context = escapeHtml(truncate(story.context, 260));
  const why = escapeHtml(truncate(story.whyItMatters, 200));
  const source = story.sourceName ? ` · ${escapeHtml(story.sourceName)}` : "";
  return `
    <div style="padding:20px 0;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.08em;color:#7c3aed;font-weight:600;">${sector}${source}</p>
      <h2 style="margin:0 0 8px;font-size:18px;line-height:1.35;">
        <a href="${link}" style="color:#0f172a;text-decoration:none;">${headline}</a>
      </h2>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">${context}</p>
      <p style="margin:0 0 10px;padding:10px 12px;background-color:#f5f3ff;border-left:3px solid #7c3aed;font-size:13px;line-height:1.55;color:#3b0764;">
        <strong style="font-weight:600;">Why it matters:</strong> ${why}
      </p>
      <p style="margin:0;font-size:12px;color:#64748b;">${story.saveCount} saves · ${story.commentCount} comments ·
        <a href="${link}" style="color:#7c3aed;text-decoration:none;">Read story →</a>
      </p>
    </div>`;
}

export function renderWeeklyDigestEmail(input: WeeklyDigestEmailInput): RenderedEmail {
  const greetName = input.name?.trim() || input.email.split("@")[0] || "there";
  const subject = `Your SIGNAL digest · ${input.weekLabel}`;
  const storyBlocks = input.stories.map((s) => renderStory(s, input.frontendUrl)).join("\n");

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;color:#64748b;text-transform:uppercase;font-weight:600;">Weekly digest · ${escapeHtml(input.weekLabel)}</p>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;">Hi ${escapeHtml(greetName)}, here are ${input.stories.length} stories worth your time.</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      Ranked by what the SIGNAL community saved and discussed this week.
    </p>
    ${storyBlocks}
    <p style="margin:28px 0 0;">
      <a href="${input.frontendUrl}/feed"
         style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;">
        Open your feed
      </a>
    </p>`;

  const html = renderLayout({
    title: subject,
    previewText: `${input.stories.length} top stories from this week in AI, finance, and semis.`,
    bodyHtml,
    frontendUrl: input.frontendUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  const text = [
    `SIGNAL weekly digest — ${input.weekLabel}`,
    `Hi ${greetName}, here are ${input.stories.length} stories worth your time.`,
    "",
    ...input.stories.map(
      (s) =>
        `• [${s.sector}] ${s.headline}\n  ${input.frontendUrl}/stories/${s.id}\n  Why it matters: ${truncate(s.whyItMatters, 200)}`,
    ),
    "",
    `Open your feed: ${input.frontendUrl}/feed`,
  ].join("\n");

  return { subject, html, text };
}
