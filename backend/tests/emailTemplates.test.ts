import { renderWelcomeEmail } from "../src/emails/welcomeEmail";
import { renderDailyDigestEmail } from "../src/emails/dailyDigestEmail";
import type { DailyDigestStory } from "../src/services/digestService";
import { renderPasswordResetEmail } from "../src/emails/passwordResetEmail";

describe("email templates", () => {
  describe("welcome", () => {
    it("renders greeting with the user's name", () => {
      const rendered = renderWelcomeEmail({
        name: "Ada Lovelace",
        email: "ada@example.com",
        frontendUrl: "https://signal.so",
        unsubscribeUrl: "https://signal.so/unsubscribe?token=abc",
      });
      expect(rendered.subject).toContain("Welcome");
      expect(rendered.html).toContain("Ada Lovelace");
      expect(rendered.html).toContain("https://signal.so/onboarding");
      expect(rendered.html).toContain("https://signal.so/unsubscribe?token=abc");
      expect(rendered.text).toContain("Welcome to SIGNAL, Ada Lovelace.");
    });

    it("falls back to email local-part when name is empty", () => {
      const rendered = renderWelcomeEmail({
        name: null,
        email: "alice@example.com",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).toContain("alice");
    });

    it("escapes HTML in user names", () => {
      const rendered = renderWelcomeEmail({
        name: "<script>alert(1)</script>",
        email: "x@y.com",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).not.toContain("<script>alert(1)</script>");
      expect(rendered.html).toContain("&lt;script&gt;");
    });
  });

  describe("daily digest (12i)", () => {
    const story = (overrides: Partial<DailyDigestStory> = {}): DailyDigestStory => ({
      id: "story-1",
      sector: "ai",
      headline: "OpenAI launches new model",
      commentary: "This changes what's possible in reasoning.",
      sourceName: "Wired",
      publishedAt: new Date("2026-05-17T08:00:00Z"),
      ...overrides,
    });

    it("renders sector-grouped sections with links + the SIGNAL Daily subject", () => {
      const bySector = new Map<string, DailyDigestStory[]>([
        ["ai", [story({ id: "ai-1" }), story({ id: "ai-2", headline: "Another AI story" })]],
        ["finance", [story({ id: "fin-1", sector: "finance", headline: "Fed move" })]],
      ]);
      const rendered = renderDailyDigestEmail({
        email: "ada@x.com",
        storiesBySector: bySector,
        dayLabel: "May 17",
        frontendUrl: "https://signal.so",
        unsubscribeUrl: "https://signal.so/unsubscribe?token=tok",
      });

      expect(rendered.subject).toBe("Your SIGNAL Daily — May 17");
      expect(rendered.html).toContain("https://signal.so/stories/ai-1");
      expect(rendered.html).toContain("https://signal.so/stories/ai-2");
      expect(rendered.html).toContain("https://signal.so/stories/fin-1");
      expect(rendered.html).toContain("AI");
      expect(rendered.html).toContain("Finance");
      expect(rendered.html).toContain("See your personalized analysis");
      expect(rendered.html).toContain("https://signal.so/unsubscribe?token=tok");
    });

    it("renders headline-only when commentary is empty (pre-backfill row)", () => {
      const bySector = new Map<string, DailyDigestStory[]>([
        ["ai", [story({ commentary: "" })]],
      ]);
      const rendered = renderDailyDigestEmail({
        email: "a@b.com",
        storiesBySector: bySector,
        dayLabel: "May 17",
        frontendUrl: "https://signal.so",
      });
      // Headline still present, but the commentary <p> block is
      // suppressed when the source text is empty.
      expect(rendered.html).toContain("OpenAI launches new model");
      // Specifically no See-your-analysis label suppression — the
      // CTA always renders so the user still has a path back.
      expect(rendered.html).toContain("See your personalized analysis");
    });

    it("truncates overly long commentary", () => {
      const long = "x".repeat(800);
      const bySector = new Map<string, DailyDigestStory[]>([
        ["ai", [story({ commentary: long })]],
      ]);
      const rendered = renderDailyDigestEmail({
        email: "a@b.com",
        storiesBySector: bySector,
        dayLabel: "May 17",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).toContain("…");
    });

    it("includes the total story count in the headline copy", () => {
      const bySector = new Map<string, DailyDigestStory[]>([
        ["ai", [story({ id: "a1" }), story({ id: "a2" }), story({ id: "a3" })]],
      ]);
      const rendered = renderDailyDigestEmail({
        email: "a@b.com",
        storiesBySector: bySector,
        dayLabel: "May 17",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).toContain("3 stories");
    });

    it("uses an unknown-sector fallback when the slug isn't in the palette", () => {
      const bySector = new Map<string, DailyDigestStory[]>([
        ["energy", [story({ id: "x1", sector: "energy" })]],
      ]);
      const rendered = renderDailyDigestEmail({
        email: "a@b.com",
        storiesBySector: bySector,
        dayLabel: "May 17",
        frontendUrl: "https://signal.so",
      });
      // Title-cased fallback label + neutral slate color.
      expect(rendered.html).toContain("Energy");
    });
  });

  describe("password reset", () => {
    it("includes reset link and expiry", () => {
      const rendered = renderPasswordResetEmail({
        name: "Ada",
        email: "a@b.com",
        resetUrl: "https://signal.so/reset?token=xyz",
        expiresInMinutes: 30,
        frontendUrl: "https://signal.so",
      });
      expect(rendered.subject).toContain("Reset");
      expect(rendered.html).toContain("https://signal.so/reset?token=xyz");
      expect(rendered.html).toContain("30 minutes");
    });
  });
});
