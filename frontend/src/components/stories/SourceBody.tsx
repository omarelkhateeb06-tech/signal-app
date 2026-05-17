"use client";

import DOMPurify from "isomorphic-dompurify";

// Phase 12e.x fix cluster — render the "From the source" body with
// safe HTML allowed. The ingestion pipeline's body extractor stores
// readability-parsed HTML (paragraphs, links, emphasis, headings,
// lists, code, blockquotes); rendering that as plain text leaves
// users staring at raw <p> tags + ⁠html escapes. This component
// runs the content through DOMPurify with a tight allowlist before
// committing to dangerouslySetInnerHTML.
//
// Strategy:
//   - SSR-safe via isomorphic-dompurify so the sanitized output
//     ships in the initial HTML, not after hydration.
//   - Tight allowlist (formatting tags only — no script, iframe,
//     style, on*= handlers, javascript: URLs).
//   - Scoped styling on the wrapper for the allowed tags so the
//     output reads as editorial prose in the design system.
//
// Plain-text contexts (feed card previews, gate teasers) continue
// to use the upstream stripHtml — this surface is detail-only.

const ALLOWED_TAGS = [
  "p",
  "br",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
  "pre",
  "hr",
] as const;

const ALLOWED_ATTR = ["href", "title", "target", "rel"] as const;

interface SourceBodyProps {
  html: string;
}

export function SourceBody({ html }: SourceBodyProps): JSX.Element {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    // Force outbound links to open in a new tab + carry noopener.
    // ADD_ATTR on its own doesn't rewrite values; the post-process
    // hook below adds the safety attributes to anchors.
    ADD_ATTR: ["target", "rel"],
    // Drop URL schemes other than http/https/mailto so a stray
    // javascript: href can't survive.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });

  // Post-sanitize, post-process anchors to set target+rel safely.
  // We rebuild as a string because we already chose dangerouslySetInnerHTML;
  // DOMPurify doesn't expose a per-node hook in this code path without
  // adding listeners that would persist across re-renders. The regex
  // edit is narrow: it only touches anchor opens that don't already
  // carry target/rel.
  const withSafeAnchors = sanitized.replace(
    /<a\b([^>]*?)>/gi,
    (match, attrs: string) => {
      const hasTarget = /\btarget=/i.test(attrs);
      const hasRel = /\brel=/i.test(attrs);
      const extra =
        (hasTarget ? "" : ' target="_blank"') +
        (hasRel ? "" : ' rel="noopener noreferrer"');
      return `<a${attrs}${extra}>`;
    },
  );

  return (
    <div
      className="source-body text-[15px] leading-[1.7] text-ink"
      dangerouslySetInnerHTML={{ __html: withSafeAnchors }}
    />
  );
}
