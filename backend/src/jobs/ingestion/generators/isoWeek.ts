// Phase 12n.x — ISO-week helpers shared by the weekly-synthesis generators
// (arxivSynthesis, hnCommunitySynthesis). Pure, UTC-anchored, no I/O.

// ISO-8601 week parts (Thursday-anchored, UTC). The ISO week-numbering year
// can differ from the calendar year at January/December boundaries — the
// returned `year` is the ISO year, so weeks like `2026-W01` are correct
// across the boundary.
export function isoWeekParts(date: Date): { year: number; week: number } {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thursday of this week
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
  return { year: isoYear, week };
}

export function isoWeekOf(date: Date): string {
  const { year, week } = isoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Human "week of May 25, 2026" — the Monday of the ISO week the date sits in.
export function weekLabelOf(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr); // Monday of this week
  return `week of ${MONTHS[target.getUTCMonth()]} ${target.getUTCDate()}, ${target.getUTCFullYear()}`;
}
