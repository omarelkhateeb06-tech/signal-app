import { renderWelcomeEmail } from "../src/emails/welcomeEmail";
import { renderWeeklyDigestEmail } from "../src/emails/weeklyDigestEmail";
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

  describe("weekly digest", () => {
    const baseStory = {
      id: "story-1",
      sector: "ai",
      headline: "OpenAI launches new model",
      context: "A new model called GPT-X was released today.",
      whyItMatters: "This changes what's possible in reasoning.",
      sourceName: "Wired",
      publishedAt: new Date("2026-04-15T00:00:00Z"),
      saveCount: 12,
      commentCount: 4,
    };

    it("renders each story with a link and metrics", () => {
      const rendered = renderWeeklyDigestEmail({
        name: "Ada",
        email: "ada@x.com",
        stories: [baseStory, { ...baseStory, id: "story-2", headline: "Other story" }],
        weekLabel: "Apr 12 – Apr 19",
        frontendUrl: "https://signal.so",
        unsubscribeUrl: "https://signal.so/unsubscribe?token=tok",
      });
      expect(rendered.subject).toContain("Apr 12 – Apr 19");
      expect(rendered.html).toContain("https://signal.so/stories/story-1");
      expect(rendered.html).toContain("https://signal.so/stories/story-2");
      expect(rendered.html).toContain("12 saves");
      expect(rendered.html).toContain("4 comments");
      expect(rendered.html).toContain("Why it matters:");
      expect(rendered.html).toContain("https://signal.so/unsubscribe?token=tok");
    });

    it("truncates overly long context / why-it-matters", () => {
      const long = "x".repeat(800);
      const rendered = renderWeeklyDigestEmail({
        name: null,
        email: "a@b.com",
        stories: [{ ...baseStory, context: long, whyItMatters: long }],
        weekLabel: "Apr 12 – Apr 19",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).toContain("…");
    });

    it("includes story count in the preview/copy", () => {
      const rendered = renderWeeklyDigestEmail({
        name: "Ada",
        email: "a@b.com",
        stories: [baseStory, baseStory, baseStory],
        weekLabel: "w",
        frontendUrl: "https://signal.so",
      });
      expect(rendered.html).toContain("3 stories");
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
