// Redesign v2 — lead-stat extraction for the data-led "Earnings / SEC" card.
//
// "The one number that mattered" should be the hero of an earnings card. There
// is no numeric field on the wire, so we surface the first figure already
// present in the commentary text — honest (it's the model's own words), never
// fabricated. Returns null when the copy carries no figure, so the card falls
// back to its terse text treatment rather than inventing a number.

// A percentage (e.g. "8%", "12.4%") or a currency figure with an optional
// magnitude word (e.g. "$4.2 billion", "$900M", "$1,204"). Scanned
// left-to-right; whichever matches first by position wins.
const PERCENT = /\b\d{1,3}(?:\.\d+)?\s?%/;
const CURRENCY =
  /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|bn|mn|[BMT])?\b/i;

/**
 * Extract the lead figure from `text` — the earliest percentage or currency
 * amount. Returns the trimmed match, or null if the text carries no figure.
 */
export function leadStat(text: string | null | undefined): string | null {
  const s = (text ?? "").trim();
  if (s === "") return null;

  const pct = PERCENT.exec(s);
  const cur = CURRENCY.exec(s);

  if (pct && cur) {
    return (pct.index <= cur.index ? pct[0] : cur[0]).replace(/\s+/g, " ").trim();
  }
  const hit = pct ?? cur;
  return hit ? hit[0].replace(/\s+/g, " ").trim() : null;
}
