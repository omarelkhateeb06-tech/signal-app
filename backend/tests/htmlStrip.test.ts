import { stripHtml } from "../src/utils/htmlStrip";

describe("stripHtml", () => {
  it("returns null for null/undefined", () => {
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stripHtml("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(stripHtml("   \n\t ")).toBeNull();
  });

  it("returns null for tags-only input that yields no text", () => {
    expect(stripHtml("<br/><br/>")).toBeNull();
  });

  it("passes through plain text unchanged (fast path)", () => {
    expect(stripHtml("Hello world")).toBe("Hello world");
  });

  it("trims leading/trailing whitespace on plain text", () => {
    expect(stripHtml("  hi  ")).toBe("hi");
  });

  it("strips simple tags", () => {
    expect(stripHtml("<b>Filed:</b> 2026-04-27")).toBe("Filed: 2026-04-27");
  });

  it("strips anchor tags but keeps the link text", () => {
    expect(stripHtml('Read more <a href="https://x">here</a>')).toBe(
      "Read more here",
    );
  });

  it("converts <br> separators to whitespace", () => {
    const out = stripHtml("Line one<br/>Line two<br>Line three");
    expect(out).toBe("Line one Line two Line three");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(stripHtml("&lt;tag&gt;")).toBe("<tag>");
    expect(stripHtml("non&nbsp;break")).toBe("non break");
  });

  it("collapses whitespace from block elements", () => {
    const out = stripHtml("<p>one</p>\n\n<p>two</p>");
    expect(out).toBe("one two");
  });

  it("strips SEC EDGAR-style summary markup", () => {
    const input =
      '<b>Filed:</b> 2026-04-27 <b>AccNo:</b> 0001234-5 <b>Size:</b> 12 KB <a href="https://www.sec.gov/x">View</a>';
    const out = stripHtml(input);
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toContain("Filed:");
    expect(out).toContain("AccNo:");
    expect(out).toContain("View");
  });
});
